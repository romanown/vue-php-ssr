import estraverse from 'estraverse';
import {analyze} from 'escope';
// let escodegen = require('escodegen');
import {isClosureVariable} from '../util';
import parseOptions from '../parseOptions';

export default function (ast) {
    // 去掉with
    estraverse.replace(ast, {
        enter: function (node, parent) {
            if (node.type == 'WithStatement') {
                return node.body;

            }
        }
    });
    // 分析scope
    let scopeManager = analyze(ast, {
        sourceType: parseOptions.sourceType,
        ecmaVersion: parseOptions.ecmaFeatures.ecmaVersion
    });
    let currentScope = scopeManager.acquire(ast);

    // 为函数调用和变量增加this，闭包不增加
    estraverse.replace(ast, {
        enter: function (node, parent) {
            // 处理所有的Identifier，也就是变量名
            // 判断是否是闭包变量，不是闭包的就需要添加this指针
            if (
                // a.b在traverse到b的时候是identity，但是不应该加this
                // 可以通过parent是否是MemberExpression来判断当前节点是否是在读取属性
                (node.type === 'Identifier'
                    && parent.type !== 'MemberExpression')
                // 另一种情况是a.b，读取到a的时候parent的object字段是a，property是b，可以通过判断是不是前一个字段来决定是否加this
                || (node.type === 'Identifier'
                    && parent.type === 'MemberExpression'
                    && parent.object.name === node.name)
            ) {
                if (!isClosureVariable(node, currentScope)) {
                //     console.log('>>>', node.name, '<<<', ' is closure variable');
                // }
                // else {
                //     console.log('>>>', node.name, '<<<', ' is not closure variable');
                    //  一定要skip，不然会死循环，因为内部有ident的结构，会递归调用
                    this.skip();
                    // console.log('>>>', node.type, '<<<', node);
                    // console.log('>>>parent<<<', parent);
                    // 返回一个this.xxx的结构
                    return {
                        "type": "MemberExpression",
                        "computed": false,
                        "object": {
                            "type": "ThisExpression"
                        },
                        "property": node
                    };
                }
            }
            // 进入新的scope
            currentScope = scopeManager.acquire(node) || currentScope;
        },
        leave: function(node) {
            currentScope = scopeManager.release(node) || currentScope;

            // do stuff
        }
    });
    let functionDeclaration = ast.body[0];
    functionDeclaration.id.name = '_render';
    return functionDeclaration;
    // console.log(JSON.stringify(ast));
    // console.log(escodegen.generate(ast));
};