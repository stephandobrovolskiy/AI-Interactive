/**
 * Demo story graph. Two scenes, a choice, two branches that merge, a second
 * choice, two branches that merge again. Random clips: the point is the
 * mechanic, not the plot. Real episodes load their own JSON in this shape.
 */

/**
 * scene    plays, then goes to `next`.
 * choice   plays, freezes on its last frame, the viewer picks one of `options`.
 * qte      plays while the viewer taps; the ring decides `win` or `lose`.
 * defeat   plays, then the defeat screen: try again from `retry`, load, or quit.
 * ending   plays, then the run is over.
 */
export type NodeKind = "scene" | "choice" | "qte" | "defeat" | "ending";

export interface StoryOption {
  label: string;
  next: string;
}

/**
 * A music cue on a node. The track starts `at` seconds into the node's clip
 * and keeps playing across later nodes until another cue replaces it or the
 * run ends; both of those fade it out over `fadeOut`.
 */
export interface MusicCue {
  /** Track URL. */
  track: string;
  /** Seconds into the clip when the track starts. Default 0. */
  at?: number;
  /** 0..1. Default 1. */
  volume?: number;
  /** Milliseconds. Default 0: the track arrives at full volume. */
  fadeIn?: number;
  /** Milliseconds. Default 0: the track stops dead. */
  fadeOut?: number;
  /** Default false: the track plays once. */
  loop?: boolean;
}

export interface StoryNode {
  id: string;
  kind: NodeKind;
  title: string;
  /**
   * The clip this node plays. On a choice it is the clip that leads up to the
   * choice: the choice opens on its last frame.
   */
  clip: string;
  /** Next node for a scene. Absent on choices, endings, and the last scene. */
  next?: string;
  /** Two options for a choice. The first sits upper right, the second lower left. */
  options?: [StoryOption, StoryOption];
  /** Seconds to decide on a choice before one option is taken at random. Default 5. */
  seconds?: number;
  /** QTE: where a full ring leads. */
  win?: string;
  /** QTE: where the clip ending on a ring that never filled leads. */
  lose?: string;
  /** QTE: how much of the ring a tap adds when the ring is empty (0..1). Default 0.08. */
  gain?: number;
  /** QTE: how much of the ring drains per second when the ring is empty. Default 0.15. */
  decay?: number;
  /** QTE: how hard a full ring fights back (0..1). Default 0.55. */
  resistance?: number;
  /** QTE: ring level that counts as a win when the clip ends (0..1). Default 0.85. */
  threshold?: number;
  /** Defeat: the node "Try again" restarts from. */
  retry?: string;
  /** Music that starts on this node. Absent: whatever is playing keeps playing. */
  music?: MusicCue;
}

export interface Story {
  id: string;
  title: string;
  start: string;
  nodes: StoryNode[];
}

export const CHOICE_SECONDS = 5;
export const QTE_GAIN = 0.08;
export const QTE_DECAY = 0.15;
export const QTE_RESISTANCE = 0.55;
export const QTE_THRESHOLD = 0.85;

export const DEMO_STORY: Story = {
  id: "demo-episode-1",
  title: "Episode 1",
  start: "scene-1",
  nodes: [
    { id: "scene-1", kind: "scene", title: "Scene 1", clip: "scene-1.mp4", next: "scene-2" },
    {
      id: "scene-2",
      kind: "choice",
      title: "First choice",
      clip: "scene-2.mp4",
      options: [
        { label: "Stay", next: "a1" },
        { label: "Leave", next: "a2" },
      ],
    },
    { id: "a1", kind: "scene", title: "Stayed", clip: "scene-a1.mp4", next: "m1" },
    { id: "a2", kind: "scene", title: "Left", clip: "scene-a2.mp4", next: "m1" },
    {
      id: "m1",
      kind: "choice",
      title: "Second choice",
      clip: "scene-m1.mp4",
      options: [
        { label: "Speak", next: "b1" },
        { label: "Stay silent", next: "b2" },
      ],
    },
    { id: "b1", kind: "scene", title: "Spoke", clip: "scene-b1.mp4", next: "m2" },
    { id: "b2", kind: "scene", title: "Silent", clip: "scene-b2.mp4", next: "m2" },
    { id: "m2", kind: "scene", title: "Morning", clip: "scene-m2.mp4", next: "fight" },
    {
      id: "fight",
      kind: "qte",
      title: "The fight",
      clip: "qte-fight.mp4",
      win: "win",
      lose: "lose",
    },
    { id: "win", kind: "ending", title: "Victory", clip: "qte-win.mp4" },
    { id: "lose", kind: "defeat", title: "Defeat", clip: "qte-lose.mp4", retry: "fight" },
  ],
};

export function nodeById(story: Story, id: string): StoryNode {
  const node = story.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Unknown story node: ${id}`);
  return node;
}

export function nextIds(node: StoryNode): string[] {
  if (node.kind === "scene" && node.next) return [node.next];
  if (node.kind === "choice" && node.options) return node.options.map((o) => o.next);
  if (node.kind === "qte") return [node.win, node.lose].filter((id): id is string => !!id);
  return [];
}

/** Every distinct clip URL in the story, in play order. */
export function storyClips(story: Story): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of story.nodes) {
    if (!seen.has(node.clip)) {
      seen.add(node.clip);
      out.push(node.clip);
    }
  }
  return out;
}

/** Every distinct music track URL in the story. */
export function storyTracks(story: Story): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of story.nodes) {
    const track = node.music?.track;
    if (track && !seen.has(track)) {
      seen.add(track);
      out.push(track);
    }
  }
  return out;
}
