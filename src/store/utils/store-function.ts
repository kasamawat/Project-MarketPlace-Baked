import slugify from "slugify";

export const toSlug = (s: string) =>
  slugify(s ?? "", { lower: true, strict: true }).replace(/-+/g, "-");
