// localStorage as a real project store — an index plus one JSON blob per
// canvas, giving actual open/save/save-as/delete/rename.
const INDEX_KEY = 'heidrun:projects';

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY)) ?? [];
  } catch {
    return [];
  }
}
function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}
function blobKey(name) {
  return `heidrun:project:${name}`;
}

export function listProjects() {
  return readIndex();
}

export function saveProject(name, serializedState) {
  localStorage.setItem(blobKey(name), serializedState);
  const idx = readIndex();
  if (!idx.includes(name)) {
    idx.push(name);
    writeIndex(idx);
  }
}

export function loadProject(name) {
  return localStorage.getItem(blobKey(name));
}

export function deleteProject(name) {
  localStorage.removeItem(blobKey(name));
  writeIndex(readIndex().filter((n) => n !== name));
}

export function renameProject(oldName, newName) {
  const data = loadProject(oldName);
  if (data == null) return false;
  saveProject(newName, data);
  deleteProject(oldName);
  return true;
}
