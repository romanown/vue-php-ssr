var core = require('./core'),
    scope = require('./scope'),
    utils = require('./utils'),
    espree = require('espree');

// 用来记录当前状态是不是进入到了init，
// 处理array的时候需要包装一层用->和[]都能读取的方法，就会要求有这样的格式
// arr(array('xxx'=>'xxx'))
// 但是函数默认值和类属性初始化不能用，所以要记录状态，是否进入到这两个状态里
// 每次进入设置为true，退出状态设置为false
let initState = false;

function compile(code) {
    let ast = parse(code);
    return generate(ast);
}

function parse(code) {
  var ast = espree.parse(code, {
    // loc : true,
    // range : true,
    // tokens : true,
    comment : true,
    ecmaVersion: 9, // ecmascript 2018
    ecmaFeatures: {
      arrowFunctions: true, // enable parsing of arrow functions
      blockBindings: true, // enable parsing of let/const
      destructuring: true, // enable parsing of destructured arrays and objects
      regexYFlag: true, // enable parsing of regular expression y flag
      regexUFlag: true, // enable parsing of regular expression u flag
      templateStrings: true, // enable parsing of template strings
      binaryLiterals: true, // enable parsing of binary literals
      octalLiterals: true, // enable parsing of ES6 octal literals
      unicodeCodePointEscapes: true, // enable parsing unicode code point escape sequences
      defaultParams: true, // enable parsing of default parameters
      restParams: true, // enable parsing of rest parameters
      forOf: true, // enable parsing of for-of statement
      objectLiteralComputedProperties: true, // enable parsing computed object literal properties
      objectLiteralShorthandMethods: true, // enable parsing of shorthand object literal methods
      objectLiteralShorthandProperties: true, // enable parsing of shorthand object literal properties
      objectLiteralDuplicateProperties: true, // Allow duplicate object literal properties (except '__proto__')
      generators: true, // enable parsing of generators/yield
      spread: true, // enable parsing spread operator
      superInFunctions: true, // enable super in functions
      classes: true, // enable parsing classes
      newTarget: false, // enable parsing of new.target
      modules: true, // enable parsing of modules
      jsx: true, // enable React JSX parsing
      globalReturn: true, // enable return in global scope
      experimentalObjectRestSpread: true // allow experimental object rest/spread
    }
  });
    return ast;
}

function generate(ast) {

  var rootScope = scope.create(ast, scope.KIND_ROOT);

  function visit(node, parent) {
    var content = "", semicolon = false;

    // set parent node
    if (parent) { node.parent = parent; }

    if (node.type == "Program" || node.type == "BlockStatement" || node.type == "ClassBody") {

      for (var i=0,length = node.body.length;i<length;i++) {
        content += visit(node.body[i], node);
      }

    } else if (node.type == "VariableDeclaration") {
      // declaration of one or multiple variables
      for (var i=0,length=node.declarations.length;i<length;i++) {
        content += visit(node.declarations[i], node);
      }

    } else if (node.type == "VariableDeclarator") {
        if (node.id.type === 'ObjectPattern') {
            let properties = node.id.properties;
            let defs = properties.map(function (property) {
                // let {a=1}  = b; => let a = b.a || 1;
                let init;
                if (property.type === 'AssignmentPattern') {
                    init = {
                        type: "LogicalExpression",
                        left: {
                            type: "MemberExpression",
                            object: node.init,
                            property: {
                                type: "Literal",
                                value: property.key.name,
                                raw: "'" + property.key.name + "'"
                            },
                            computed: true 
                        },
                        operator: "||",
                        right: property.value.right
                    }; 
                }
                else {
                    init = {
                        type: "MemberExpression",
                        object: node.init,
                        property: {
                            type: "Literal",
                            value: property.key.name,
                            raw: "'" + property.key.name + "'"
                        },
                        computed: true 
                    };
                }
                let newNode = {
                    type: "VariableDeclaration",
                    declarations: [
                        {
                            type: "VariableDeclarator",
                            id: property.key,
                            init: init
                        }
                    ],
                    kind: "var"
                };
                scope.get(node).register(newNode);
                return '$' + property.key.name
                    + ' = ' + visit(init, node) + ';';
            });
            content = defs.join('\n') + '\n';
        }
        else {
            scope.get(node).register(node);

            // declaration of one variable
            content = '$' + node.id.name;

            if (node.init) {
                content += ' = ' + visit(node.init, node);
                semicolon = true;
            } else if (node.parent.parent.type !== "ForInStatement" &&
                node.parent.parent.type !== "ForStatement" &&
                node.parent.parent.type !== "ForOfStatement") {
                content += ' = null';
                semicolon = true;
            }
        }

    } else if (node.type == "Identifier") {
      var identifier = (node.name || node.value);
      identifier = identifier.replace(/\$/g, '_');
      content = '';
      if (node.leadingComments && /^\s*ref/.test(node.leadingComments[0].value)) {
          content += '&';
      }

      if (!node.static && !node.isCallee && !node.isMemberExpression && identifier !== '__FILE__' && identifier !== 'self' && !/^Class_/.test(identifier)) {
        scope.get(node).getDefinition(node);
        content += "$";
      }

      content += identifier;

    } else if (node.type == "Punctuator") {
      content = node.value;

    } else if (node.type == "Literal") {

      var value = (node.raw.match(/^["']undefined["']$/)) ? "NULL" : node.raw;
      if (/^\//.test(value)) {
          value = '\'' + value + '\'';
      }
      if (/JSX/.test(node.parent.type)) {
          value = '\'' + value + '\'';
      }
      content = value;

    } else if (node.type == "BinaryExpression" || node.type == "LogicalExpression") {

      if (node.operator == 'in') {
        content = visit({
          type: 'CallExpression',
          callee: {
            type: 'Identifier',
            name: 'isset',
          },
          arguments: [{
            type: 'MemberExpression',
            computed: true,
            object: node.right,
            property: node.left
          }]
        }, node);

      } else if (node.operator === "+") {
        content = 'func_add(' + visit(node.left, node) + "," + visit(node.right, node) + ')';
      } else {
        let operator;
        let type = parent.type;

        if (
            type === 'AssignmentExpression'
            || type === 'VariableDeclarator'
        ) {
            operator = '=';
        }
        else if (type === 'ConditionalExpression') {
            operator = '?:';
        }
        else if (type === 'UnaryExpression') {
            operator = parent.operator;
        }
        else if (type === 'NewExpression') {
            operator = 'new';
        }
        else if (type === 'MemberExpression') {
            operator = '.';
        }
        else if (type === 'CallExpression') {
            operator = '()';
        }
        else {
            operator = parent.operator;
        }

        content = visit(node.left, node) + ' ' + node.operator + ' ' + visit(node.right, node);
        if (utils.comparePriority(operator, node.operator)) {
            content = '(' + content + ')';
        }
      }

    } else if (node.type == "AssignmentExpression" ||
      node.type == "AssignmentPattern") {
      scope.get(node).register(node.left);

      content = visit(node.left, node) + " " + (node.operator || "=") + " " + visit(node.right, node);

    } else if (node.type == "ConditionalExpression") {
      content = "((" + visit(node.test, node) + ")" +
        " ? " + visit(node.consequent, node) +
        " : " + visit(node.alternate, node) + ")";

    } else if (node.type == "UnaryExpression") {

      // override typeof unary expression
      if (node.operator == 'typeof') {
        content = visit({
          type: 'CallExpression',
          callee: {
            type: 'Identifier',
            name: 'gettype',
          },
          arguments: [node.argument]
        }, node);

        // override delete unary expression
      } else if (node.operator == 'delete') {
        content = visit({
          type: 'CallExpression',
          callee: {
            type: 'Identifier',
            name: 'unset',
          },
          arguments: [node.argument]
        }, node);

      } else {
        content = node.operator + visit(node.argument, node);
      }

    } else if (node.type == "ExpressionStatement") {
      content = visit(node.expression, node);
      semicolon = true;

    } else if (node.type == "CallExpression") {

      var calleeDefined = scope.get(node).getDefinition(node.callee);

      node.callee.isCallee = (!calleeDefined || calleeDefined && (calleeDefined.type != "Identifier" &&
        calleeDefined.type != "VariableDeclarator"));

      if (node.callee.type === 'Super') {
        content += 'parent::__construct';
      } else {
        content += visit(node.callee, node);
      }

      // inline anonymous call
      if ((node.callee.isCallee && node.callee.type == "FunctionDeclaration") ||
        node.type == "ArrowFunctionExpression") {
        var identifier = null;
        if (node.parent.type == "VariableDeclarator") {
          // var something = (function() { return 0; })();
          identifier = node.parent.id.name;
        } else if (node.parent.type == "AssignmentExpression") {
          // something = (function() { return 0; })();
          identifier = node.parent.left.name;
        }
        content += ";$" + identifier + " = " + "$" + identifier;
      }

      if (node.arguments) {
        var args = [];

        for (var i=0, length = node.arguments.length; i < length; i++) {
          args.push( visit(node.arguments[i], node) );
        }

        content += "(" + args.join(', ') + ")";
      }

      // allow semicolon if parent node isn't MemberExpression or Property
      if (node.parent && node.parent.type == "ExpressionStatement") {
        semicolon = true;
      }

    } else if (node.type == "MemberExpression") {
      var newNode = core.evaluate(node);

      if (node != newNode) {
        // fix parent node type
        content = visit(newNode, node.parent);

      } else {

        var object, property;

        if (node.object.type == "MemberExpression" && node.object.object && node.object.property) {
          object = node.object.object,
            property = node.object.property;
        } else {
          object = node.object;
          property = node.property;
        }

        // object.static = (object.name || object.value || "").match(/^[A-Z]/);
        object.static = /^[A-Z]/.test(object.name || object.value || "");
        property.static = /^[A-Z]/.test(property.name || property.value || "");

        var accessor;
        if (node.property.static && object.static) {
          accessor = "\\"; // namespace
        } else if ((property.static || object.static) || object.type == "Super") {
          accessor = "::"; // static
        } else {
          accessor = "->"; // instance
        }
        if (node.object.type === 'Identifier' && node.object.name === 'self') {
            content = "self::" + visit(node.property, node);
        }
        else {
          if (node.computed) {
            if (node.object.type === "ThisExpression") {
                // this[xxx] 会被解析成 this->$xxx
                // 但是aaa[xxx]不会改变
              content = visit(node.object, node) + "->" + visit(node.property, node);
            }
            else {
              // a['$xxx'] => a['_xxx']
              if (node.property.type === 'Literal') {
                  node.property.raw = node.property.raw.replace(/\$/g, '_');
              }
              content = visit(node.object, node) + "[" + visit(node.property, node) + "]";
            }
          } else {
            node.property.isMemberExpression = true;
            content = visit(node.object, node) + accessor + visit(node.property, node);
          }
        }

      }

    } else if (node.type == "FunctionDeclaration" ||
      node.type == "ArrowFunctionExpression") {
      var param,
        parameters = [],
        defaults = node.defaults || [];

      // function declaration creates a new scope
      scope.create(node);

      // compute function params
      for (var i=0; i < node.params.length; i++) {
        if (defaults[i]) {
          param = visit({
            type: "BinaryExpression",
            left: node.params[i],
            operator: '=',
            right: defaults[i]
          }, node);
        } else {
          param = visit(node.params[i], node)
        }

        // register parameter identifiers
        if (scope.get(node).parent) {
          scope.get(node).register(node.params[i]);
        }

        parameters.push(param);
      }

      var func_contents = visit(node.body, node),
        using = scope.get(node).using;
      content = 'function ';
      if (node.id && node.id.leadingComments && /^\s*ref/.test(node.id.leadingComments[0].value)) {
          content += '&';
      }
      content += (node.id) ? node.id.name : "";
      content += "(" + parameters.join(", ") + ") ";

      // try to use parent's variables
      // http://php.net/manual/pt_BR/functions.anonymous.php
      if (using.length > 0) {
        content += "use (" + using.map(function(identifier) {
          return "&$" + identifier;
        }).join(', ') + ") ";
      }

      content += "{\n";
      if (node.body.type === 'BinaryExpression') {
        // x => x * 2
        content += "return " + func_contents + ";\n";
      } else {
        content += func_contents + ";\n";
      }
      content += "}\n";

    } else if (node.type == "ObjectExpression") {
      let enterInitState = false;
      if (
          utils.isArgument(node.parent)
          || utils.isClassProperty(node.parent)
      ) {
          enterInitState = true;
          initState = true;
      }
      var properties = [];
      for (var i=0; i < node.properties.length; i++) {
        properties.push( visit(node.properties[i], node) )
      }
      content = "array(" + properties.join(", ") + ")";
      if (!initState) {
          content = 'func_arr(' + content + ')';
      }
      if (enterInitState) {
          initState = false;
      }

    } else if (node.type == "ArrayExpression") {
      let enterInitState = false;
      if (
          utils.isArgument(node.parent)
          || utils.isClassProperty(node.parent)
      ) {
          enterInitState = true;
          initState = true;
      }
      var elements = [];
      for (var i=0; i < node.elements.length; i++) {
        elements.push( visit(node.elements[i], node) )
      }
      content = "array(" + elements.join(", ") + ")";
      if (!initState) {
          content = 'func_arr(' + content + ')';
      }
      if (enterInitState) {
          initState = false;
      }

    } else if (node.type == "Property") {
        var property = '';
        if (node.key.type === 'Literal') {
          property = (node.key.type == 'Identifier') ? node.key.name : node.key.value;
        }
        else if (node.key.type === 'Identifier') {
          property = node.key.name;
        }
        else {
          property = (node.key.property.type == 'Identifier') ? node.key.property.name : node.key.property.value;
        }
        // var property = (node.key.type == 'Identifier') ? node.key.name : node.key.value;
        if (parent.type === 'ClassBody') {
            content = 'public $' + property + ' = ' + visit(node.value, node) + ';\n';
        }
        else {
            content = '"'+property+'" => ' + visit(node.value, node);
        }

    } else if (node.type == "ReturnStatement") {
      semicolon = true;
      content = "return";

      if (node.argument) {
        content += " " + visit(node.argument, node);
      }

    } else if (node.type == "ClassDeclaration") {
      content = "class " + node.id.name

      if (node.superClass) {
        if (node.superClass.name === 'ArrayAccess') {
          content += " implements \\" + node.superClass.name;
        } 
        else {
          content += " extends " + node.superClass.name;
        }
      }

      var s = scope.create(node);
      content += "\n{\n";
      content += visit(node.body, node);

      if (s.getters.length > 0) {
        content += "function __get($_property) {\n";
        for (var i=0;i<s.getters.length;i++) {
          content += "if ($_property === '"+s.getters[i].key.name+"') {\n";
          let value = s.getters[i].value;
          if (value.type === 'ObjectExpression') {
              let property = value.properties.find(property => property.key.name === 'get');
              if (property) {
                  content += visit(property.value.body, node);
              }
          }
          else {
              content += visit(value.body, node);
          }
          content += "}\n";
        }
        content += "}\n";
      }

      if (s.setters.length > 0) {
        content += "function __set($_property, $value) {\n";
        for (var i=0;i<s.setters.length;i++) {
          content += "if ($_property === '"+s.setters[i].key.name+"') {\n";
          let value = s.setters[i].value;
          if (value.type === 'ObjectExpression') {
              let property = value.properties.find(property => property.key.name === 'set');
              if (property) {
                  content += visit(property.value.body, node);
              }
          }
          else {
              content += visit(value.body, node);
          }
          content += "}\n";
        }
        content += "}\n";
      }

      content += "\n}\n";

      if (node.namespace) {
          content += `const ${node.id.name} = '${node.namespace}\\${node.id.name}';\n`;  
      }


    } else if (node.type == "MethodDefinition") {
      scope.get(node).register(node);

      // define getters and setters on scope
      if (node.kind == "get" || node.kind == "set") {
        return "";
      }

      var isConstructor = (node.key.name == "constructor");
      if (isConstructor) { node.key.name = "__construct"; }

      // Re-use FunctionDeclaration structure for method definitions
      node.value.type = "FunctionDeclaration";
      if (node.leadingComments && /^\s*ref/.test(node.leadingComments[0].value)) {
        node.value.id = { name: '&' + node.key.name };
      }
      else {
        node.value.id = { name: node.key.name };
      }

        // console.log(node.value);

      var tmpContent = visit(node.value, node);

      // try to define public properties there were defined on constructor
      if (isConstructor) {
        node.key.name = "__construct";
        var definitions = scope.get(node.value).definitions;
        for(var i in definitions) {
          if (
              definitions[i]
              && definitions[i].type == "MemberExpression"
              && !/^["']/.test(definitions[i].property.raw)
          ) {
            let property = definitions[i].property;
            property.isMemberExpression = false;
            if (definitions[i].object.name === 'self') {
                content += "static " + visit(property, null) + " = " + visit(definitions[i].parent.right) + ";\n";
            }
            else {
                if (/priv_/.test(property.name)) {
                    content += 'private ';
                }
                else {
                    content += 'public ';
                }
                content += visit(property, null) + ";\n";
            }
          }
        }
      }

      // every method is public.
      content += "public ";
      if (node.static) { content += "static "; }

      content += tmpContent;

    } else if (node.type == "ThisExpression") {
      content = "$this";

    } else if (node.type == "Super") {
      content = "parent";

    } else if (node.type == "IfStatement") {
      content = "if ("+visit(node.test, node)+") {\n";
      content += visit(node.consequent, node) + "}";

      if (node.alternate) {
        content += " else ";

        if (node.alternate.type == "BlockStatement") {
          content += "{"+visit(node.alternate, node)+"}";

        } else {
          content += visit(node.alternate, node)
        }
      }

    } else if (node.type == "SequenceExpression") {
      var expressions = [];

      for (var i=0;i<node.expressions.length;i++) {
        expressions.push( visit(node.expressions[i], node) );
      }

      content = expressions.join(', ') + ";";

    } else if (node.type == "WhileStatement") {

      content = "while (" + visit(node.test, node) + ") {";
      content += visit(node.body, node);
      content += "}";

    } else if (node.type == "DoWhileStatement") {

      content = "do {";
      content += visit(node.body, node);
      content += "} while (" + visit(node.test, node) + ")";
      semicolon = true;

    } else if (node.type == "ForStatement") {
      content = "for (";
      node.init && (content += visit(node.init, node));
      node.test && (content += visit(node.test, node) + ";" );
      node.update && (content += visit(node.update, node));
      content += ") {";
      node.body && (content += visit(node.body, node));
      content += "}";

    } else if (node.type == "ForInStatement" || node.type == "ForOfStatement") {
      content = "foreach (func_getArr(" + visit(node.right, node) + ") as " + visit(node.left, node)+ " => $___)";
      content += "{" + visit(node.body, node) + "}";

    } else if (node.type == "UpdateExpression") {

      if (node.prefix) {
        content += node.operator;
      }

      content += visit(node.argument, node);

      if (!node.prefix) {
        content += node.operator;
      }

    } else if (node.type == "SwitchStatement") {
      content = "switch (" + visit(node.discriminant, node) + ")";
      content += "{";
      for (var i=0; i < node.cases.length; i++) {
        content += visit(node.cases[i], node) + "\n";
      }
      content += "}";

    } else if (node.type == "SwitchCase") {

      if (node.test) {
        content += "case " + visit(node.test, node) + ":\n";
      } else {
        content =  "default:\n";
      }

      for (var i=0; i < node.consequent.length; i++) {
        content += visit(node.consequent[i], node);
      }

    } else if (node.type == "BreakStatement") {
      content = "break;";

    } else if (node.type == "ContinueStatement") {
      content = "continue;";

    } else if (node.type == "NewExpression") {
      // re-use CallExpression for NewExpression's
      var newNode = utils.clone(node);
      newNode.type = "CallExpression";

      return "new " + visit(newNode, node);

    } else if (node.type == "FunctionExpression") {

      // Re-use FunctionDeclaration structure for method definitions
      node.type = "FunctionDeclaration";
      node.id = { name: node.id || "" };

      content = visit(node, node.parent);

    } else if (node.type == "RestElement") {
      content += "...$" + node.argument.name;

    } else if (node.type == "SpreadElement") {
      content += "..." + visit(node.argument, node);

      // Modules & Export (http://wiki.ecmascript.org/doku.php?id=harmony:modules_examples)
    } else if (node.type == "NamespaceDeclaration") {
      content = "namespace " + utils.classize(node.id.name) + ";\n";

    } else if (node.type == "ExportNamedDeclaration") {
      content = visit(node.declaration, node);

    } else if (node.type == "ExportDefaultDeclaration") {
      content = visit(node.declaration, node);

    } else if (node.type == "ImportDeclaration") {
      for (var i=0,length = node.specifiers.length;i<length;i++) {
        content += visit(node.specifiers[i], node);
      }

    } else if (node.type == "ImportDefaultSpecifier") {
      var modulePath = node.parent.source.value;
      content += "require_once(dirname(__FILE__) . \"\/" + modulePath + ".php\");\n";
      if (node.parent.namespace) {
          content += 'use ';
          // 为了hack php use function的约定
          // 如果import名字是以func开头，则表示需要导出的是function
          if (node.local && /^func/.test(node.local.name)) {
              content += "function ";
          }
          var namespace = utils.classize(node.parent.namespace.value);
          content += "\\" + namespace + (node.raw === undefined ? "" : "\\" + node.raw);
          // alias
          if (node.local) {
              content += " as " + node.local.name;
          }
          content += ";\n";
          if (node.local && /^Class_/.test(node.local.name)) {
              content += 'use const';
              content += "\\" + namespace + (node.raw === undefined ? "" : "\\" + node.raw);
              // alias
              if (node.local) {
                  content += " as " + node.local.name;
              }
              content += ";\n";
          }
      }

    } else if (node.type == "ImportSpecifier") {
      var modulePath = node.parent.source.value;
      content += "require_once(dirname(__FILE__) . \"\/" + modulePath + ".php\");\n";
      if (node.parent.namespace) {
          content += 'use ';
          if (node.local && /^func/.test(node.local.name)) {
              content += "function ";
          }
          var namespace = utils.classize(node.parent.namespace.value);
          content += "\\" + namespace + "\\" + node.imported.name;
          // alias
          if (node.local) { content += " as " + node.local.name; }
          content += ";\n";
      }



    } else if (node.type == "TemplateLiteral") {
      var expressions = node.expressions
        , quasis = node.quasis
        , nodes = quasis.concat(expressions).sort(function(a, b) {
          return b.range[0] < a.range[0];
        })
        , cooked = "";

      for (var i=0; i<nodes.length; i++) {
        if (nodes[i].type == "TemplateElement") {
          cooked += nodes[i].value.cooked;
        } else {
          cooked += '{' + visit(nodes[i], node) + '}';
        }
      }

      content += '"' + cooked + '"';

    } else if (node.type === "TryStatement") {
      content += "try {\n";
      content += visit(node.block, node);
      content += "}";

      if (node.handler) {
        content += visit(node.handler, node);
      }

      if (node.finalizer) {
        content += " finally {\n";
        content += visit(node.finalizer, node);
	      content += "}\n";
      }

    } else if (node.type === "CatchClause") {
      content += ' catch (Exception ';
      scope.create(node.param, node);
      content += visit(node.param, node);
      content += ") {\n";
      content += visit(node.body, node);
      content += "}\n";
    } else if (node.type === "ThrowStatement") {
      content += "throw " + visit(node.argument, node);
      semicolon = true;
    } else if (node.type === "EmptyStatement") {
        // nothing;
    } else if (node.type === 'JSXElement') {

        content += 'array(';
        content += '    "tag" => ' + visit(node.openingElement.name, node) + ',\n';
        content += '    "attr" => ' + visit(node.openingElement, node) + ',\n';
        content += '    "children" => array(';
        var children = node.children;
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            content += visit(child, node) + ',\n';
        }
        content += '    )';
        content += ')';

    } else if (node.type === 'JSXOpeningElement') {

        content += 'array(';
        for (var i = 0; i < node.attributes.length; i++) {
            content += visit(node.attributes[i], node) + ',';
        }
        content += ')';

    } else if (node.type === 'JSXClosingElement') {
        // nothing

    } else if (node.type === 'JSXAttribute') {

        content += visit(node.name, node) + ' => ' + visit(node.value, node);

    } else if (node.type === 'JSXIdentifier') {

        content = '\'' + node.name + '\'';

    } else if (node.type === 'JSXExpressionContainer') {

        content += visit(node.expression, node);

    } else {
      console.log("'" + node.type + "' not implemented.", node);
    }
    // append semicolon when required
    if (semicolon && !content.match(/;\n?$/)) {
      content += ";\n";
    }

    return content;
  }

  return "<?php\n" + visit(ast);
};

module.exports = {
    compile,
    generate
};
