import path from 'path';
import {compile, recursiveCompile} from '../src/index';

(async function () {
    await recursiveCompile(path.resolve(__dirname, './index.js'));
    //await compile(path.resolve(__dirname, './dataset/index.vue'));
})();

