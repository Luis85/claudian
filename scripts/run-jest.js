const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const jestPath = require.resolve('jest/bin/jest');
const localStorageFile = path.join(os.tmpdir(), 'claudian-localstorage');
const warningFlags = process.allowedNodeEnvironmentFlags?.has('--disable-warning=ExperimentalWarning')
  ? ['--disable-warning=ExperimentalWarning']
  : [];
const forwardedArgs = process.argv.slice(2);
const hasExplicitWorkerMode = forwardedArgs.some((arg) => (
  arg === '--runInBand'
  || arg === '-i'
  || arg === '--watch'
  || arg === '--watchAll'
  || arg === '-w'
  || arg === '--maxWorkers'
  || arg.startsWith('--maxWorkers=')
));
const workerFlags = hasExplicitWorkerMode ? [] : ['--runInBand'];

const result = spawnSync(
  process.execPath,
  [
    `--localstorage-file=${localStorageFile}`,
    ...warningFlags,
    jestPath,
    ...workerFlags,
    ...forwardedArgs,
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
