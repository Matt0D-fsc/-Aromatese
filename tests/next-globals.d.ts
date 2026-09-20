// RouteContext is a global Next generates for typed routes; it exists inside web/'s own TypeScript program,
// not this one. Declared here so a test can import a route handler and still be typechecked at the root.
declare global {
  type RouteContext<Route extends string = string> = {
    params: Promise<Record<string, string>> & { __route?: Route };
  };
}
export {};
