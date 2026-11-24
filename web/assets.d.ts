/** Pictures imported by the page; Bun's bundler turns them into URLs. */
declare module "*.jpg" {
  const url: string;
  export default url;
}
