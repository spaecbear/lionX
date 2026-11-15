/** errno-style error codes the VFS can raise. Messages match glibc strerror(). */
export type ErrnoCode =
  | 'ENOENT'
  | 'EACCES'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'EEXIST'
  | 'ENOTEMPTY'
  | 'EPERM'
  | 'EINVAL'
  | 'EBUSY';

export const ERRNO_MESSAGES: Record<ErrnoCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
  EBUSY: 'Device or resource busy',
};

export class VfsError extends Error {
  readonly code: ErrnoCode;
  /** The path the error is about, as the caller passed it (for command error messages). */
  readonly path: string;

  constructor(code: ErrnoCode, path: string) {
    super(`${path}: ${ERRNO_MESSAGES[code]}`);
    this.name = 'VfsError';
    this.code = code;
    this.path = path;
  }

  /** The bare strerror text, e.g. "No such file or directory". */
  get reason(): string {
    return ERRNO_MESSAGES[this.code];
  }
}

export function isVfsError(e: unknown, code?: ErrnoCode): e is VfsError {
  return e instanceof VfsError && (code === undefined || e.code === code);
}
