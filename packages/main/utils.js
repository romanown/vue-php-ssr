import path from 'path';
import fs from 'fs';
import {
    baseDir,
    outputPath
} from './config';

export function getOutputFilePath(filePath) {
    let relativePath = path.relative(baseDir, filePath);
    let outputFilePath = path.resolve(outputPath, relativePath);
    let parsedPath = path.parse(outputFilePath);
    return {
        outputFileDir: parsedPath.dir,
        outputFilePath
    };
}

export function getFilePath(importPath) {
    let ext = ['', '.js', '.vue', '.jsx', '.es6', '.php', '/index.js', '/index.vue', '/index.jsx', '/index.es6', '/index.php'];
    for (var i = 0; i < ext.length; i++) {
        let p = importPath + ext[i];
        if(fs.existsSync(p)) {
            let stats = fs.statSync(p);
            if (stats.isFile()) {
                return {
                    filePath: p,
                    // 当前名称文件没找到，找到了index文件
                    filePathWithOutExt: i > 5 ? importPath + '/index' : importPath
                };
            }
        }
    }
    return;
}
