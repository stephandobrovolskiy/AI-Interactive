import { defineInteractiveFilm, mountInteractiveFilm, InteractiveFilmElement } from "./player";

defineInteractiveFilm();

export { mountInteractiveFilm, InteractiveFilmElement };
export type { MenuAction, MountOptions } from "./player";
