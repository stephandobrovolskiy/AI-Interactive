import stageCss from "./stage.css?inline";
import { ensureFonts } from "./fonts";
import { clipUrl } from "./preload";
import { latestSlot, markSeen, readSeen, type SaveSlot } from "./saves";
import {
  defeatScreen,
  loadingScreen,
  pauseScreen,
  progressScreen,
  slotsScreen,
} from "./screens";
import { choiceScreen, type ChoiceParts } from "./choice";
import { qteScreen, type QteParts } from "./qte";
import {
  CHOICE_SECONDS,
  DEMO_STORY,
  QTE_DECAY,
  QTE_GAIN,
  QTE_RESISTANCE,
  QTE_THRESHOLD,
  nextIds,
  nodeById,
  type MusicCue,
  type Story,
  type StoryNode,
} from "./story";
import { PAUSE_MARK, pressable, wordList } from "./ui";

const TAG = "interactive-film";

const PLAY_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M7 4.5v15l12-7.5z" fill="currentColor"/>
</svg>`;

export type MenuAction = "new" | "continue" | "load" | "progress";

const MUSIC_VOLUME = 0.45;
const MUSIC_FADE_MS = 1600;
const MENU_MUSIC_OUT_MS = 800;
const PANEL_OUT_MS = 200;
const PAUSE_BUTTON_HIDE_MS = 2600;

interface Run {
  nodeId: string;
  path: string[];
}

const fades = new WeakMap<HTMLMediaElement, number>();

/**
 * Volume ramp with an ease-out, so a track arrives rather than creeps in and
 * leaves without a click. Retargets if called again mid-ramp.
 */
function fadeVolume(
  audio: HTMLMediaElement,
  target: number,
  ms: number,
  onDone?: () => void,
): void {
  const pending = fades.get(audio);
  if (pending !== undefined) cancelAnimationFrame(pending);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (ms <= 0) {
    audio.volume = clamp(target);
    fades.delete(audio);
    onDone?.();
    return;
  }
  const from = audio.volume;
  const t0 = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, Math.max(0, (t - t0) / ms));
    const e = 1 - Math.pow(1 - p, 3);
    audio.volume = clamp(from + (target - from) * e);
    if (p < 1) {
      fades.set(audio, requestAnimationFrame(step));
    } else {
      fades.delete(audio);
      onDone?.();
    }
  };
  fades.set(audio, requestAnimationFrame(step));
}

/**
 * <interactive-film poster="..." episode="..." video="..." music="...">
 *
 * The game stage. A 9:16 portrait window that fills the screen on phones
 * and sits centered, height-fit, on a dark ground everywhere else.
 * Styles are scoped to a shadow root so the host page's CSS cannot reach in.
 *
 * Attributes
 *   poster   URL of the still shown behind the start screen and under the
 *            menu video until it plays.
 *   blur     URL of a small, pre-blurred copy of the poster for the start
 *            screen. Without it the blur is computed live, which is costly.
 *   episode  Title shown on the start screen and in the menu header.
 *   video    URL of the looping background video for the main menu.
 *   music    URL of the looping menu music. Starts after the first tap.
 *
 * Events
 *   start    Fired once, when the start screen has cleared and the menu is up.
 *   menu     Fired on a menu choice. detail: { action }
 *   scene    Fired when the game shows a story node. detail: { nodeId }
 */
export class InteractiveFilmElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["poster", "blur", "episode", "video", "music"];
  }

  private readonly root: ShadowRoot;
  private screenEl!: HTMLDivElement;
  private overlayEl!: HTMLDivElement;
  private posterImg!: HTMLImageElement;
  private startEl: HTMLDivElement | null = null;
  private startBlurImg: HTMLImageElement | null = null;
  private startTitle: HTMLHeadingElement | null = null;
  private menuEl: HTMLDivElement | null = null;
  private menuHead: HTMLParagraphElement | null = null;
  private bgVideo: HTMLVideoElement | null = null;
  private music: HTMLAudioElement | null = null;
  private started = false;

  private readonly story: Story = DEMO_STORY;
  private readonly panels: HTMLElement[] = [];
  private gameEl: HTMLDivElement | null = null;
  private sceneVideo: HTMLVideoElement | null = null;
  /** Every clip that can come next, mounted under the current one and parked on its first frame. */
  private parked: HTMLVideoElement[] = [];
  private choice: ChoiceParts | null = null;
  private qte: QteParts | null = null;
  private sceneMusic: HTMLAudioElement | null = null;
  private sceneCue: MusicCue | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private pauseHide = 0;
  private run: Run | null = null;
  private seen: Set<string> = new Set();

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    ensureFonts();
    if (this.root.childElementCount === 0) {
      this.render();
    }
    this.syncAttributes();
    this.seen = readSeen();
    // Media is fetched now, while the start screen is up, so the tap only has to play it.
    this.prepareBackgroundVideo();
    this.prepareMusic();
    document.addEventListener("visibilitychange", this.onVisibility);
    // Two frames so the first paint lands before the hairline fades in.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.setAttribute("data-ready", ""));
    });
  }

  disconnectedCallback(): void {
    this.removeAttribute("data-ready");
    this.stopMusic();
    this.stopSceneMusic(0);
    this.bgVideo?.pause();
    this.sceneVideo?.pause();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Browsers pause media in hidden tabs; pick it back up when the tab returns. */
  private readonly onVisibility = (): void => {
    if (document.hidden) return;
    const video = this.bgVideo;
    if (video && video.paused && !this.gameEl) void video.play().catch(() => {});
    if (this.started && this.music && this.music.paused && !this.gameEl) {
      void this.music.play().catch(() => {});
    }
    const inScene = this.gameEl && !this.gameEl.hasAttribute("data-paused") && !this.choice;
    if (inScene && this.qte) this.qte.resume();
    if (inScene && this.sceneVideo?.paused && !this.sceneVideo.ended) {
      void this.sceneVideo.play().catch(() => {});
    }
    if (inScene && this.sceneMusic?.paused) void this.sceneMusic.play().catch(() => {});
  };

  attributeChangedCallback(): void {
    if (this.root.childElementCount > 0) {
      this.syncAttributes();
      if (this.isConnected) {
        this.prepareBackgroundVideo();
        this.prepareMusic();
      }
    }
  }

  /** The layer video is mounted into. */
  get screen(): HTMLDivElement {
    return this.screenEl;
  }

  /** The layer on-stage UI is mounted into. */
  get overlay(): HTMLDivElement {
    return this.overlayEl;
  }

  private get poster(): string {
    return this.getAttribute("poster") ?? "";
  }

  private syncAttributes(): void {
    const poster = this.poster;
    const episode = this.getAttribute("episode") ?? "";

    const applyPoster = (img: HTMLImageElement | null) => {
      if (!img) return;
      if (poster) {
        if (img.getAttribute("src") !== poster) img.src = poster;
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.hidden = true;
      }
    };
    applyPoster(this.posterImg);

    const blur = this.getAttribute("blur") ?? "";
    const blurImg = this.startBlurImg;
    if (blurImg) {
      const src = blur || poster;
      if (src) {
        if (blurImg.getAttribute("src") !== src) blurImg.src = src;
        blurImg.hidden = false;
      } else {
        blurImg.removeAttribute("src");
        blurImg.hidden = true;
      }
      const wrap = blurImg.parentElement;
      if (wrap) {
        if (blur) wrap.removeAttribute("data-live");
        else wrap.setAttribute("data-live", "");
      }
    }

    if (this.startTitle) {
      this.startTitle.textContent = episode;
      this.startTitle.hidden = episode.length === 0;
    }
    if (this.menuHead) {
      this.menuHead.textContent = episode;
      this.menuHead.hidden = episode.length === 0;
    }
  }

  private render(): void {
    const style = document.createElement("style");
    style.textContent = stageCss;

    const ground = document.createElement("div");
    ground.className = "ground";

    const well = document.createElement("div");
    well.className = "well";

    const stage = document.createElement("div");
    stage.className = "stage";
    stage.setAttribute("role", "region");
    stage.setAttribute("aria-label", "Interactive film");

    const screen = document.createElement("div");
    screen.className = "screen";
    this.screenEl = screen;

    const poster = document.createElement("img");
    poster.alt = "";
    poster.decoding = "async";
    poster.draggable = false;
    this.posterImg = poster;
    screen.append(poster);

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    this.overlayEl = overlay;

    overlay.append(this.renderStart());

    stage.append(screen, overlay);
    well.append(stage);
    this.root.append(style, ground, well);
  }

  // ---------------------------------------------------------------------------
  // Start screen
  // ---------------------------------------------------------------------------

  private renderStart(): HTMLDivElement {
    const start = document.createElement("div");
    start.className = "start";
    start.setAttribute("role", "button");
    start.setAttribute("tabindex", "0");
    start.setAttribute("aria-label", "Tap to start");
    this.startEl = start;

    const press = document.createElement("div");
    press.className = "start-press";

    const blur = document.createElement("div");
    blur.className = "start-blur";
    const blurImg = document.createElement("img");
    blurImg.alt = "";
    blurImg.decoding = "async";
    blurImg.draggable = false;
    this.startBlurImg = blurImg;
    blur.append(blurImg);

    const scrim = document.createElement("div");
    scrim.className = "start-scrim";

    press.append(blur, scrim);

    const copy = document.createElement("div");
    copy.className = "start-copy";

    const mark = document.createElement("div");
    mark.className = "start-mark";
    mark.innerHTML = PLAY_MARK;

    const text = document.createElement("div");
    text.className = "start-text";

    const title = document.createElement("h1");
    title.className = "start-title";
    this.startTitle = title;

    const prompt = document.createElement("p");
    prompt.className = "start-prompt";
    prompt.textContent = "Tap to start";

    text.append(title, prompt);
    copy.append(mark, text);
    start.append(press, copy);

    // The screen is shown only once the poster has decoded: no bare frame first.
    const reveal = () => start.setAttribute("data-shown", "");
    if (blurImg.complete && blurImg.naturalWidth > 0) {
      reveal();
    } else {
      blurImg.addEventListener("load", reveal, { once: true });
      blurImg.addEventListener("error", reveal, { once: true });
      setTimeout(() => {
        if (!blurImg.getAttribute("src")) reveal();
      }, 0);
    }

    pressable(start, () => this.begin());
    return start;
  }

  /** Clears the start screen, brings up the menu, fires `start`. */
  begin(): void {
    if (this.started || !this.startEl) return;
    this.started = true;

    const start = this.startEl;
    start.setAttribute("data-leaving", "");
    start.removeAttribute("tabindex");
    start.setAttribute("aria-hidden", "true");

    // Media starts on the tap itself: this is the gesture browsers require.
    this.playBackgroundVideo();
    this.playMusic();

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The menu mounts under the clearing start screen and enters as the blur lifts.
    const menu = this.renderMenu();
    this.overlayEl.append(menu);
    setTimeout(
      () => {
        requestAnimationFrame(() => menu.setAttribute("data-in", ""));
      },
      reduced ? 0 : 380,
    );

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      start.remove();
      this.startEl = null;
      this.startBlurImg = null;
      this.startTitle = null;
      this.menuEl?.querySelector<HTMLButtonElement>(".word")?.focus({ preventScroll: true });
      this.dispatchEvent(new CustomEvent("start", { bubbles: true, composed: true }));
    };

    const img = start.querySelector(".start-blur > img");
    if (img && !reduced) {
      img.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 900);
    } else {
      setTimeout(done, 320);
    }
  }

  // ---------------------------------------------------------------------------
  // Main menu
  // ---------------------------------------------------------------------------

  private renderMenu(): HTMLDivElement {
    const menu = document.createElement("div");
    menu.className = "menu";
    this.menuEl = menu;

    const scrim = document.createElement("div");
    scrim.className = "menu-scrim";

    const head = document.createElement("p");
    head.className = "menu-head";
    head.textContent = this.getAttribute("episode") ?? "";
    head.hidden = head.textContent.length === 0;
    this.menuHead = head;

    const list = wordList(
      [
        { label: "New game", onSelect: () => this.choose("new") },
        { label: "Continue", onSelect: () => this.choose("continue") },
        { label: "Load", onSelect: () => this.choose("load") },
        { label: "Progress", onSelect: () => this.choose("progress") },
      ],
      "Main menu",
    );

    menu.append(scrim, head, list);
    return menu;
  }

  /** A main-menu choice. */
  choose(action: MenuAction): void {
    this.dispatchEvent(
      new CustomEvent("menu", { detail: { action }, bubbles: true, composed: true }),
    );
    switch (action) {
      case "new":
        this.startRun({ nodeId: this.story.start, path: [] }, "New game");
        break;
      case "continue": {
        const latest = latestSlot();
        if (latest) this.startRun({ nodeId: latest.nodeId, path: latest.path }, "Continuing");
        else this.startRun({ nodeId: this.story.start, path: [] }, "New game");
        break;
      }
      case "load":
        this.push(
          slotsScreen({
            mode: "load",
            story: this.story,
            poster: this.poster,
            onBack: () => this.pop(),
            onLoad: (slot: SaveSlot) => {
              this.pop();
              this.startRun({ nodeId: slot.nodeId, path: slot.path }, "Loading");
            },
          }),
        );
        break;
      case "progress":
        this.push(
          progressScreen(this.story, this.seen, this.run?.nodeId ?? null, () => this.pop()),
        );
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Panels: screens stacked over whatever is underneath
  // ---------------------------------------------------------------------------

  private push(el: HTMLElement): void {
    const under = this.panels[this.panels.length - 1];
    under?.setAttribute("data-covered", "");
    this.panels.push(el);
    this.overlayEl.append(el);
    this.menuEl?.setAttribute("data-covered", "");
    this.gameEl?.setAttribute("data-covered", "");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.setAttribute("data-in", "");
        el.querySelector<HTMLElement>("button:not([aria-disabled='true'])")?.focus({
          preventScroll: true,
        });
      });
    });
  }

  private pop(): void {
    const el = this.panels.pop();
    if (!el) return;
    el.removeAttribute("data-in");
    el.setAttribute("data-out", "");
    setTimeout(() => el.remove(), PANEL_OUT_MS);
    const under = this.panels[this.panels.length - 1];
    if (under) {
      under.removeAttribute("data-covered");
      under.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }
    if (this.panels.length === 0) {
      this.menuEl?.removeAttribute("data-covered");
      this.gameEl?.removeAttribute("data-covered");
      const under = this.gameEl ?? this.menuEl;
      under?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }
  }

  private popAll(): void {
    while (this.panels.length > 0) this.pop();
  }

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------

  private startRun(run: Run, caption: string): void {
    const loading = loadingScreen(this.story, caption);
    this.push(loading.root);
    loading.done
      .then(() => {
        this.enterGame(run);
        this.pop();
      })
      .catch(() => {
        // The loading screen shows the failure; a tap takes the viewer back.
        loading.root.addEventListener("pointerup", () => this.pop(), { once: true });
      });
  }

  private enterGame(run: Run): void {
    this.run = run;
    this.menuEl?.setAttribute("data-hidden", "");

    const game = document.createElement("div");
    game.className = "game";
    game.setAttribute("tabindex", "0");
    game.setAttribute("aria-label", "Scene");
    this.gameEl = game;

    const button = document.createElement("button");
    button.className = "pause-button";
    button.type = "button";
    button.setAttribute("aria-label", "Pause");
    button.innerHTML = PAUSE_MARK;
    pressable(button, () => this.pause());
    this.pauseButton = button;

    game.append(button);

    // A tap on the scene shows the pause control for a moment.
    game.addEventListener("pointerup", (e) => {
      if (e.target === button || button.contains(e.target as Node)) return;
      this.showPauseButton();
    });
    game.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        this.pause();
      }
    });

    this.overlayEl.append(game);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        game.setAttribute("data-in", "");
        game.focus({ preventScroll: true });
      });
    });

    // The menu loop stops decoding while a scene is up; it resumes on quit.
    // Menu music leaves too: in a scene only the scene is heard.
    this.bgVideo?.pause();
    const music = this.music;
    if (music) fadeVolume(music, 0, MENU_MUSIC_OUT_MS, () => music.pause());
    this.showNode(run.nodeId);
  }

  /** A scene clip: plays once, with its own sound, and cuts to the next. */
  private createSceneVideo(clip: string): HTMLVideoElement {
    const video = document.createElement("video");
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    video.disablePictureInPicture = true;
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("data-scene", "");
    video.dataset.clip = clip;
    video.src = clipUrl(clip);
    return video;
  }

  private showNode(nodeId: string): void {
    if (!this.run) return;
    const node = nodeById(this.story, nodeId);
    this.run.nodeId = nodeId;
    if (this.run.path[this.run.path.length - 1] !== nodeId) this.run.path.push(nodeId);
    this.seen = markSeen([nodeId]);

    // Use the clip parked under the current one if it is there; otherwise
    // (first scene, or a jump) mount a fresh element. Other parked clips go.
    let video = this.parked.find((v) => v.dataset.clip === node.clip) ?? null;
    for (const v of this.parked) if (v !== video) v.remove();
    this.parked = [];
    if (!video) {
      video = this.createSceneVideo(node.clip);
      this.screenEl.append(video);
    }

    const previous = this.sceneVideo;
    const choice = this.choice;
    const qte = this.qte;
    this.choice = null;
    this.qte = null;
    this.sceneVideo = video;

    // The old clip (and whatever sat over it) stays until the new one's first
    // frame has actually painted, so the cut is frame to frame.
    video.addEventListener(
      "playing",
      () => {
        video.setAttribute("data-playing", "");
        if (previous) {
          previous.pause();
          previous.remove();
        }
        if (choice) {
          choice.dispose();
          choice.root.remove();
          this.gameEl?.removeAttribute("data-choosing");
          this.gameEl?.focus({ preventScroll: true });
        }
        if (qte) {
          qte.dispose();
          qte.root.remove();
          this.gameEl?.removeAttribute("data-qte");
          this.gameEl?.focus({ preventScroll: true });
        }
      },
      { once: true },
    );
    video.addEventListener("ended", () => this.onSceneEnded(node), { once: true });
    void video.play().catch(() => {});

    this.applyMusicCue(node, video);
    if (node.kind === "qte") this.openQte(node);

    const ahead = nextIds(node);
    if (node.kind === "defeat" && node.retry) ahead.push(node.retry);
    this.primeNext(ahead.map((id) => nodeById(this.story, id).clip));

    this.dispatchEvent(
      new CustomEvent("scene", { detail: { nodeId }, bubbles: true, composed: true }),
    );
  }

  /**
   * Mounts every clip that can come next under the current one, parked on its
   * first frame. One clip decodes at a time: a paused element only holds the
   * frame it shows.
   */
  private primeNext(clips: string[]): void {
    for (const clip of new Set(clips)) {
      const video = this.createSceneVideo(clip);
      this.parked.push(video);
      this.screenEl.append(video);
      video.load();
    }
  }

  private onSceneEnded(node: StoryNode): void {
    if (!this.run || this.sceneVideo?.dataset.clip !== node.clip) return;
    if (node.kind === "choice" && node.options) {
      this.openChoice(node);
      return;
    }
    if (node.kind === "qte" && node.win && node.lose) {
      this.showNode(this.qte?.won ? node.win : node.lose);
      return;
    }
    if (node.kind === "defeat") {
      this.openDefeat(node);
      return;
    }
    if (node.kind === "scene" && node.next) {
      this.showNode(node.next);
      return;
    }
    this.finishRun();
  }

  /** The fight is on: the tap mark goes up over the playing clip. */
  private openQte(node: StoryNode): void {
    const game = this.gameEl;
    if (!game) return;
    const qte = qteScreen({
      gain: node.gain ?? QTE_GAIN,
      decay: node.decay ?? QTE_DECAY,
      resistance: node.resistance ?? QTE_RESISTANCE,
      threshold: node.threshold ?? QTE_THRESHOLD,
    });
    this.qte = qte;
    this.pauseButton?.removeAttribute("data-shown");
    clearTimeout(this.pauseHide);
    game.setAttribute("data-qte", "");
    game.append(qte.root);
    if (game.matches(":focus-within")) qte.root.focus({ preventScroll: true });
  }

  /** The defeat clip has played out. Try again, load, or leave. */
  private openDefeat(node: StoryNode): void {
    const game = this.gameEl;
    if (!game || game.hasAttribute("data-paused")) return;
    game.setAttribute("data-paused", "");
    game.setAttribute("data-ended", "");
    this.pauseButton?.removeAttribute("data-shown");
    clearTimeout(this.pauseHide);

    this.push(
      defeatScreen({
        onRetry: () => {
          if (!node.retry) return;
          this.popAll();
          game.removeAttribute("data-paused");
          game.removeAttribute("data-ended");
          this.showNode(node.retry);
        },
        onLoad: () =>
          this.push(
            slotsScreen({
              mode: "load",
              story: this.story,
              poster: this.poster,
              onBack: () => this.pop(),
              onLoad: (slot: SaveSlot) => {
                this.popAll();
                this.leaveGame(false);
                this.startRun({ nodeId: slot.nodeId, path: slot.path }, "Loading");
              },
            }),
          ),
        onQuit: () => this.quitToMenu(),
      }),
    );
  }

  /** The clip has stopped on its last frame; the choice opens on top of it. */
  private openChoice(node: StoryNode): void {
    const game = this.gameEl;
    const video = this.sceneVideo;
    if (!game || !video || !node.options) return;

    const frame = document.createElement("canvas");
    frame.width = video.videoWidth || 1080;
    frame.height = video.videoHeight || 1920;
    frame.getContext("2d")?.drawImage(video, 0, 0, frame.width, frame.height);

    const options = node.options;
    const choice = choiceScreen(frame, options, node.seconds ?? CHOICE_SECONDS, {
      onChoose: (index) => {
        if (this.choice !== choice) return;
        this.showNode(options[index].next);
      },
    });
    this.choice = choice;
    this.pauseButton?.removeAttribute("data-shown");
    clearTimeout(this.pauseHide);
    game.setAttribute("data-choosing", "");
    game.append(choice.root);
    // Keyboard lands on the first option, without stealing a pointer's hover.
    if (game.matches(":focus-within") && !matchMedia("(hover: hover)").matches) {
      choice.root.querySelector<HTMLButtonElement>(".choice-half")?.focus({ preventScroll: true });
    }
  }

  /**
   * The sequence has run out. The last frame holds, and a pause that cannot be
   * resumed offers the one way on: back to the menu.
   */
  private finishRun(): void {
    const game = this.gameEl;
    if (!game || game.hasAttribute("data-paused")) return;
    game.setAttribute("data-paused", "");
    game.setAttribute("data-ended", "");
    this.pauseButton?.removeAttribute("data-shown");
    clearTimeout(this.pauseHide);
    this.stopSceneMusic();

    const nothing = () => {};
    this.push(
      pauseScreen({
        final: true,
        onResume: nothing,
        onProgress: nothing,
        onSave: nothing,
        onQuit: () => this.quitToMenu(),
      }),
    );
  }

  // Scene music: started by a node's cue, kept across nodes, replaced by the
  // next cue or dropped when the run ends.

  private applyMusicCue(node: StoryNode, video: HTMLVideoElement): void {
    const cue = node.music;
    if (!cue) return;
    const at = cue.at ?? 0;
    if (at <= 0) {
      this.startTrack(cue);
      return;
    }
    const onTime = () => {
      if (this.sceneVideo !== video) {
        video.removeEventListener("timeupdate", onTime);
        return;
      }
      if (video.currentTime < at) return;
      video.removeEventListener("timeupdate", onTime);
      this.startTrack(cue);
    };
    video.addEventListener("timeupdate", onTime);
  }

  private startTrack(cue: MusicCue): void {
    this.stopSceneMusic();
    const audio = new Audio();
    audio.loop = cue.loop ?? false;
    audio.preload = "auto";
    audio.volume = 0;
    audio.src = clipUrl(cue.track);
    this.sceneMusic = audio;
    this.sceneCue = cue;
    void audio
      .play()
      .then(() => fadeVolume(audio, cue.volume ?? 1, cue.fadeIn ?? 0))
      .catch(() => {});
  }

  /** Fades the current track out over its own cue's `fadeOut`, or `ms` if given. */
  private stopSceneMusic(ms?: number): void {
    const audio = this.sceneMusic;
    const cue = this.sceneCue;
    this.sceneMusic = null;
    this.sceneCue = null;
    if (!audio) return;
    fadeVolume(audio, 0, ms ?? cue?.fadeOut ?? 0, () => {
      audio.pause();
      audio.src = "";
    });
  }

  private showPauseButton(): void {
    const button = this.pauseButton;
    if (!button) return;
    button.setAttribute("data-shown", "");
    clearTimeout(this.pauseHide);
    this.pauseHide = window.setTimeout(
      () => button.removeAttribute("data-shown"),
      PAUSE_BUTTON_HIDE_MS,
    );
  }

  private pause(): void {
    const game = this.gameEl;
    if (!game || game.hasAttribute("data-paused")) return;
    game.setAttribute("data-paused", "");
    this.pauseButton?.removeAttribute("data-shown");
    clearTimeout(this.pauseHide);
    this.sceneVideo?.pause();
    this.sceneMusic?.pause();
    this.choice?.pause();
    this.qte?.pause();

    this.push(
      pauseScreen({
        onResume: () => this.resume(),
        onProgress: () =>
          this.push(
            progressScreen(this.story, this.seen, this.run?.nodeId ?? null, () => this.pop()),
          ),
        onSave: () =>
          this.push(
            slotsScreen({
              mode: "save",
              story: this.story,
              poster: this.poster,
              current: this.run ?? undefined,
              onBack: () => this.pop(),
            }),
          ),
        onQuit: () => this.quitToMenu(),
      }),
    );
  }

  private resume(): void {
    const game = this.gameEl;
    if (!game) return;
    if (game.hasAttribute("data-ended")) return;
    this.popAll();
    game.removeAttribute("data-paused");
    if (this.choice) {
      this.choice.resume();
    } else {
      void this.sceneVideo?.play().catch(() => {});
    }
    this.qte?.resume();
    void this.sceneMusic?.play().catch(() => {});
    (this.qte?.root ?? game).focus({ preventScroll: true });
  }

  private quitToMenu(): void {
    this.popAll();
    this.leaveGame(true);
  }

  /** Tears the run down. With `toMenu` the menu, its loop and its music return. */
  private leaveGame(toMenu: boolean): void {
    const game = this.gameEl;
    const video = this.sceneVideo;
    const parked = this.parked;
    this.choice?.dispose();
    this.choice = null;
    this.qte?.dispose();
    this.qte = null;
    this.gameEl = null;
    this.sceneVideo = null;
    this.parked = [];
    this.pauseButton = null;
    this.run = null;
    this.stopSceneMusic(MENU_MUSIC_OUT_MS);
    if (game) {
      game.removeAttribute("data-in");
      setTimeout(() => game.remove(), PANEL_OUT_MS);
    }
    for (const v of parked) v.remove();
    if (video) {
      video.pause();
      video.removeAttribute("data-playing");
      setTimeout(() => video.remove(), 300);
    }
    if (!toMenu) return;
    this.menuEl?.removeAttribute("data-hidden");
    void this.bgVideo?.play().catch(() => {});
    this.playMusic();
    this.menuEl?.querySelector<HTMLButtonElement>(".word")?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  /** Creates the menu video and starts it, muted, under the start screen. */
  private prepareBackgroundVideo(): void {
    const src = this.getAttribute("video");
    if (!src || this.bgVideo) return;

    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.preload = "auto";
    video.disablePictureInPicture = true;
    video.setAttribute("aria-hidden", "true");
    video.src = src;
    video.addEventListener("playing", () => video.setAttribute("data-playing", ""), { once: true });
    this.bgVideo = video;
    this.screenEl.append(video);
    // Muted playback needs no gesture, so the loop is already running under the
    // start screen. The tap reveals a moving picture instead of starting one.
    // The first attempt can be refused while the element is still being set up,
    // so it is retried once the browser reports it can play.
    const tryPlay = () => {
      if (!video.paused) return;
      void video.play().catch(() => {});
    };
    video.addEventListener("canplay", tryPlay);
    video.addEventListener("loadeddata", tryPlay);
    tryPlay();
  }

  private playBackgroundVideo(): void {
    const video = this.bgVideo;
    if (!video) return;
    void video.play().catch(() => {});
  }

  /** Creates the menu music and starts fetching it. Does not play. */
  private prepareMusic(): void {
    const src = this.getAttribute("music");
    if (!src || this.music) return;

    const audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    audio.src = src;
    this.music = audio;
    audio.load();
  }

  private playMusic(): void {
    const audio = this.music;
    if (!audio) return;
    void audio
      .play()
      .then(() => fadeVolume(audio, MUSIC_VOLUME, MUSIC_FADE_MS))
      .catch(() => {});
  }

  private stopMusic(): void {
    if (this.music) {
      fadeVolume(this.music, 0, 0);
      this.music.pause();
      this.music.src = "";
      this.music = null;
    }
  }
}

export function defineInteractiveFilm(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, InteractiveFilmElement);
  }
}

export interface MountOptions {
  poster?: string;
  blur?: string;
  episode?: string;
  video?: string;
  music?: string;
}

/**
 * Programmatic mount for host pages that prefer a function call
 * over writing the tag themselves.
 */
export function mountInteractiveFilm(
  container: Element,
  options: MountOptions = {},
): InteractiveFilmElement {
  defineInteractiveFilm();
  const el = document.createElement(TAG) as InteractiveFilmElement;
  for (const key of ["poster", "blur", "episode", "video", "music"] as const) {
    const value = options[key];
    if (value) el.setAttribute(key, value);
  }
  container.replaceChildren(el);
  return el;
}
