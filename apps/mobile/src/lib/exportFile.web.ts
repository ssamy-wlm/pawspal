// The web version: the browser downloads the data as a file made in memory (nothing is sent anywhere).
export async function saveExport(fileName: string, json: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
