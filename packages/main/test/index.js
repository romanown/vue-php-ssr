import fs from 'fs';
import path from 'path';
import compiler from '../index';

let file = fs.readFileSync(path.resolve(__dirname, './dataset/index3.vue'));

let compiled = compiler.compile(file.toString());
console.log(compiled.phpCode);
// console.log(compiled.vdom);

// let ast = compiled.template.ast.children[0].children;
// let ast = compiled.template.ast;
// console.log(JSON.stringify(ast));