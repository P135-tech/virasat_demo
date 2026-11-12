import type { Admin } from "./reels.server";

/**
 * Does the store's live theme support app blocks (Online Store 2.0)?
 * 2.0 themes have JSON templates such as templates/index.json; older ("vintage") themes don't.
 */
export async function themeSupportsAppBlocks(admin: Admin): Promise<{ supported: boolean | null; themeName: string | null }> {
  try {
    const res = await admin.graphql(`#graphql
      query MainTheme {
        themes(first: 1, roles: [MAIN]) {
          nodes {
            name
            files(filenames: ["templates/index.json", "templates/product.json"], first: 2) { nodes { filename } }
          }
        }
      }`);
    const json = (await res.json()) as {
      data?: { themes: { nodes: { name: string; files: { nodes: { filename: string }[] } }[] } };
    };
    const theme = json.data?.themes.nodes[0];
    if (!theme) return { supported: null, themeName: null };
    return { supported: theme.files.nodes.length > 0, themeName: theme.name };
  } catch {
    return { supported: null, themeName: null };
  }
}
