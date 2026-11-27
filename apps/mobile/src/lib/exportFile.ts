// Hands the person their data as a file. On a phone: write it to the app's cache folder, open the share sheet (Save to Files,
// email, ...), then delete the copy again. The text is never logged. The web version is exportFile.web.ts.
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

/** Returns false when this phone cannot share files. */
export async function saveExport(fileName: string, json: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, fileName);
  try {
    file.create({ overwrite: true });
    file.write(json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: fileName });
    return true;
  } finally {
    try { file.delete(); } catch { /* the system also clears the cache folder */ }
  }
}
