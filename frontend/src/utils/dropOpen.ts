// 拖放打开的类型校验（v0.2.7）：取文件扩展名（小写，不含点）并查白名单。
// 白名单来自 Go 绑定 SupportedExts()（app.go），此处只做纯函数便于单测；
// 真校验守门仍在 Go openBookAt，前端校验仅用于「即时拒绝、不闪 loading」。

/** 从路径/文件名取扩展名（小写，不含点）；无扩展名返回空串。 */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 判断文件名是否属于支持打开的类型。
 * @param name   拖入的文件路径或文件名
 * @param allowed 白名单（如 ["epub","pdf","txt"]），来自 SupportedExts()
 */
export function isSupportedExt(name: string, allowed: string[]): boolean {
  const ext = extOf(name);
  return ext !== "" && allowed.includes(ext);
}
