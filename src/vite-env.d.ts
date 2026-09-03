/// <reference types="vite/client" />
declare module "*.css?inline" {
  const css: string;
  export default css;
}
declare module "*.woff2?inline" {
  const dataUrl: string;
  export default dataUrl;
}
