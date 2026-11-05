// Material Icon Theme icons (MIT) from the file-icons mod: tables copied here as material-icons.js,
// SVGs read from mods/file-icons/icons/. Same matching rules as file-icons' icon().
import ICONS from "./material-icons.js";

const DIR = "mods/file-icons/icons";
const bare = name => name.replace(/^__(.+)__$/, "$1").replace(/^[._-]/, "");
const opened = id => id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
const lookup = (table, key, dark) => (dark ? undefined : ICONS.light[table][key]) ?? ICONS[table][key];

export function fileIcon(path, dir, open, dark) {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1];
  const table = dir ? "folderNames" : "fileNames", find = key => lookup(table, key, dark) ?? (dir ? lookup(table, bare(key), dark) : undefined);
  let id;
  for (let i = 0; !id && i < parts.length - 1; i++) id = find(parts.slice(i).join("/"));
  if (dir) { id ??= find(name) ?? ICONS.folder; return `${DIR}/${open ? opened(id) : id}.svg`; }
  id ??= lookup(table, name, dark);
  for (let dot = name.indexOf("."); !id && dot !== -1; dot = name.indexOf(".", dot + 1)) id = lookup("fileExtensions", name.slice(dot + 1), dark);
  return `${DIR}/${id ?? ICONS.file}.svg`;
}
