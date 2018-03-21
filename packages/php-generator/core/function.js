function apply(node, isCall) {
  var method, args = [];

  if (node.object.property) {
    node.object.property.type = "Literal"
    node.object.property.raw = "'"+node.object.property.name+"'";

    args.push({
      type: "ArrayExpression",
      elements: [ node.object.object, node.object.property ]
    })
  } else {
    node.object.type = "Literal"
    node.object.raw = "'"+node.object.name+"'";
    args.push(node.object);
  }

  // remove first argument, which overrides the this
  node.parent.arguments.shift();

  if (isCall) {
    // .call use call_user_func
    method = "call_user_func";
    args = args.concat(node.parent.arguments);
  } else {
    // .apply use call_user_func_array
    method = "call_user_func_array";
    args.push({
      type: "ArrayExpression",
      elements: (node.parent.arguments[0] || {elements:[]}).elements
    });
  }

  node.parent.arguments = false;

  return {
    type: 'CallExpression',
    callee: {
      type: 'Identifier',
      name: method,
    },
    args: args
  };
}

module.exports = {

  call: function(node) {
    return apply(node, true);
  },

  apply: function(node, isCall) {
    return apply(node, false)
  },

}
