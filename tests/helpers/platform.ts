 
// Platform-conditional test selectors. Registered in eslint.config.mjs under
// jest/no-standalone-expect additionalTestBlockFunctions so `expect` inside them is recognized.

/** Runs on POSIX, skips on Windows. */
export const itPosix = process.platform === 'win32' ? it.skip : it;
/** Runs on Windows, skips on POSIX. */
export const itWin32 = process.platform === 'win32' ? it : it.skip;
