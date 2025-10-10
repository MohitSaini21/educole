export function deleteFileIfExists(relativePath, label = "") {
  if (!relativePath) return;

  const fullPath = path.join(process.cwd(), "public", relativePath);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`🗑️ Deleted ${label}: ${relativePath}`);
    } catch (err) {
      console.error(`❗ Error deleting ${label}: ${relativePath}`, err);
    }
  }
}
