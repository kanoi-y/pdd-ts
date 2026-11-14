import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('.',import.meta.url)),test:{include:['tests/**/*.test.ts'],maxWorkers:1}};
