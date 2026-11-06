/**
 * Resolve relative `.js` imports to their TypeScript source sibling while a
 * benchmark imports a package source file directly. Built package output uses
 * the normal `.js` exports and does not need this loader.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js")) {
    const sourceSpecifier = `${specifier.slice(0, -3)}.ts`;
    try {
      return await nextResolve(sourceSpecifier, context);
    } catch {
      // This is a real JavaScript import; let Node resolve it normally.
    }
  }
  return nextResolve(specifier, context);
}
