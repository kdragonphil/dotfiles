export const OPEN_LOCATION = "files-plus.open-location";
export const OPEN_OPTIONS = [
  { value: "tab", label: "가운데 패널의 새 탭" },
  { value: "pane", label: "가운데 패널의 분할 창" },
  { value: "internal", label: "오른쪽 패널 안" },
];

export function openLocation(value) {
  return OPEN_OPTIONS.some(option => option.value === value) ? value : "internal"; // local default: open inside the right panel
}
