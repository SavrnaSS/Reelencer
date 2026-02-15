export type AppRole = "admin" | "worker";

export function isRole(x: any): x is AppRole {
  return x === "admin" || x === "worker";
}
