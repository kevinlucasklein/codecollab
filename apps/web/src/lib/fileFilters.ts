// File filtering for Bulk GitHub Import

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.vscode',
  '.idea'
]);

const EXCLUDED_EXTENSIONS = new Set([
  // Binaries / Images / Media
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp',
  'mp3', 'mp4', 'wav', 'ogg', 'webm',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Lockfiles & build artifacts
  'lock', 'pyc', 'pyo', 'pyd', 'class', 'jar', 'exe', 'dll', 'so', 'dylib'
]);

export function isImportableFile(filePath: string): boolean {
  // Check directories
  const parts = filePath.split('/');
  for (const part of parts) {
    if (EXCLUDED_DIRECTORIES.has(part)) {
      return false;
    }
  }

  // Check extensions
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension && EXCLUDED_EXTENSIONS.has(extension)) {
    return false;
  }

  // Prevent exact matches of lock files that don't end in .lock
  if (filePath.endsWith('package-lock.json') || filePath.endsWith('yarn.lock') || filePath.endsWith('pnpm-lock.yaml')) {
    return false;
  }

  return true;
}
