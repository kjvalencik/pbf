'use strict';

module.exports = compile;

function compile(proto) {
    var code = 'var exports = {};\n';
    code += compileRaw(proto) + '\n';
    code += 'return exports;\n';
    return new Function(code)();
}

compile.raw = compileRaw;

function compileRaw(proto, options) {
    var context = buildDefaults(buildContext(proto, null), proto.syntax);
    return '\'use strict\';\n' + writeContext(context, options || {});
}

function writeContext(ctx, options) {
    var code = '';
    if (ctx._proto.fields) code += writeMessage(ctx, options);
    if (ctx._proto.values) code += writeEnum(ctx, options);

    for (var i = 0; i < ctx._children.length; i++) {
        code += writeContext(ctx._children[i], options);
    }
    return code;
}

function writeMessage(ctx, options) {
    var name = ctx._name;
    var fields = ctx._proto.fields;

    var code = '\n// ' + name + ' ========================================\n\n';

    if (!options.noRead) {
        code += compileExport(ctx, options) + ' {};\n\n';

        code += name + '.read = function (pbf, end) {\n';
        code += '    return pbf.readFields(' + name + '._readField, ' + compileDest(ctx) + ', end);\n';
        code += '};\n';
        code += name + '._readField = function (tag, obj, pbf) {\n';

        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var readCode = compileFieldRead(ctx, field);
            code += '    ' + (i ? 'else if' : 'if') +
                ' (tag === ' + field.tag + ') obj.' + field.name +
                (field.repeated && !isPacked(field) ?
                    '.push(' + readCode + ')' : ' = ' + readCode) + ';\n';
        }
        code += '};\n';
    }

    if (!options.noWrite) {
        code += name + '.write = function (obj, pbf) {\n';
        var numRepeated = 0;
        for (i = 0; i < fields.length; i++) {
            field = fields[i];
            var writeCode = field.repeated && !isPacked(field) ?
                compileRepeatedWrite(ctx, field, numRepeated++) :
                compileFieldWrite(ctx, field, field.name);
            code += getDefaultWriteTest(ctx, field);
            code += writeCode + ';\n';
        }
        code += '};\n';
    }
    return code;
}

function writeEnum(ctx, options) {
    return '\n' + compileExport(ctx, options) + ' ' +
        JSON.stringify(ctx._proto.values, null, 4) + ';\n';
}

function compileExport(ctx, options) {
    var exportsVar = options.exports || 'exports';
    return (ctx._root ? 'var ' + ctx._name + ' = ' + exportsVar + '.' : '') + ctx._name + ' =';
}

function compileDest(ctx) {
    var props = [];
    for (var i = 0; i < ctx._proto.fields.length; i++) {
        var field = ctx._proto.fields[i];

        if (field.repeated && !isPacked(field))
            props.push(field.name + ': []');

        if (field.options.default !== undefined)
            props.push(field.name + ': ' + JSON.stringify(field.options.default));
    }
    return '{' + props.join(', ') + '}';
}

function getType(ctx, field) {
    var path = field.type.split('.');
    return path.reduce(function(ctx, name) { return ctx && ctx[name]; }, ctx);
}

function compileFieldRead(ctx, field) {
    var type = getType(ctx, field);
    if (type) {
        if (type._proto.fields) return type._name + '.read(pbf, pbf.readVarint() + pbf.pos)';
        if (type._proto.values) return 'pbf.readVarint()';
        throw new Error('Unexpected type: ' + type._name);
    }

    var prefix = 'pbf.read';
    if (isPacked(field)) prefix += 'Packed';

    switch (field.type) {
    case 'string':   return prefix + 'String()';
    case 'float':    return prefix + 'Float()';
    case 'double':   return prefix + 'Double()';
    case 'bool':     return prefix + 'Boolean()';
    case 'enum':
    case 'uint32':
    case 'uint64':
    case 'int32':
    case 'int64':    return prefix + 'Varint()';
    case 'sint32':
    case 'sint64':   return prefix + 'SVarint()';
    case 'fixed32':  return prefix + 'Fixed32()';
    case 'fixed64':  return prefix + 'Fixed64()';
    case 'sfixed32': return prefix + 'SFixed32()';
    case 'sfixed64': return prefix + 'SFixed64()';
    case 'bytes':    return prefix + 'Bytes()';
    default:         throw new Error('Unexpected type: ' + field.type);
    }
}

function compileFieldWrite(ctx, field, name) {
    var prefix = 'pbf.write';
    if (isPacked(field)) prefix += 'Packed';

    var postfix = (isPacked(field) ? '' : 'Field') + '(' + field.tag + ', obj.' + name + ')';

    var type = getType(ctx, field);
    if (type) {
        if (type._proto.fields) return prefix + 'Message(' + field.tag + ', ' + type._name + '.write, obj.' + name + ')';
        if (type._proto.values) return prefix + 'Varint' + postfix;
        throw new Error('Unexpected type: ' + type._name);
    }

    switch (field.type) {
    case 'string':   return prefix + 'String' + postfix;
    case 'float':    return prefix + 'Float' + postfix;
    case 'double':   return prefix + 'Double' + postfix;
    case 'bool':     return prefix + 'Boolean' + postfix;
    case 'enum':
    case 'uint32':
    case 'uint64':
    case 'int32':
    case 'int64':    return prefix + 'Varint' + postfix;
    case 'sint32':
    case 'sint64':   return prefix + 'SVarint' + postfix;
    case 'fixed32':  return prefix + 'Fixed32' + postfix;
    case 'fixed64':  return prefix + 'Fixed64' + postfix;
    case 'sfixed32': return prefix + 'SFixed32' + postfix;
    case 'sfixed64': return prefix + 'SFixed64' + postfix;
    case 'bytes':    return prefix + 'Bytes' + postfix;
    default:         throw new Error('Unexpected type: ' + field.type);
    }
}

function compileRepeatedWrite(ctx, field, numRepeated) {
    return 'for (' + (numRepeated ? '' : 'var ') +
        'i = 0; i < obj.' + field.name + '.length; i++) ' +
        compileFieldWrite(ctx, field, field.name + '[i]');
}

function buildContext(proto, parent) {
    var obj = Object.create(parent);
    obj._proto = proto;
    obj._children = [];

    if (parent) {
        parent[proto.name] = obj;

        if (parent._name) {
            obj._root = false;
            obj._name = parent._name + '.' + proto.name;
        } else {
            obj._root = true;
            obj._name = proto.name;
        }
    }

    for (var i = 0; proto.enums && i < proto.enums.length; i++) {
        obj._children.push(buildContext(proto.enums[i], obj));
    }

    for (i = 0; proto.messages && i < proto.messages.length; i++) {
        obj._children.push(buildContext(proto.messages[i], obj));
    }

    return obj;
}

function castDefaultValue(field, value) {
    switch (field.type) {
    case 'string':   return value;
    case 'float':
    case 'double':   return parseFloat(value);
    case 'bool':     return value === 'true';
    case 'uint32':
    case 'uint64':
    case 'int32':
    case 'int64':
    case 'sint32':
    case 'sint64':
    case 'fixed32':
    case 'fixed64':
    case 'sfixed32':
    case 'sfixed64': return parseInt(value, 10);
    default:         throw new Error('Unexpected type: ' + field.type);
    }
}

function getDefaultValue(field) {
    switch (field.type) {
    case 'float':
    case 'double':
    case 'enum':
    case 'uint32':
    case 'uint64':
    case 'int32':
    case 'int64':
    case 'sint32':
    case 'sint64':
    case 'fixed32':
    case 'fixed64':
    case 'sfixed32':
    case 'sfixed64': return 0;
    case 'string':   return '';
    case 'bool':     return false;
    default:         return undefined;
    }
}

function setDefaultValue(ctx, field, syntax) {
    var options = field.options;
    var type = getType(ctx, field);
    var values = type && type._proto.values;

    // Proto3 does not support overriding defaults
    if (syntax === 3) {
        delete options.default;
    }

    // Set default for enum values
    if (values) {
        options.default = values[options.default] || 0;

    // Defaults are always strings, cast them to appropriate type
    } else if (options.default !== undefined) {
        options.default = castDefaultValue(field, options.default);

    // Set field type appropriate default
    } else {
        options.default = getDefaultValue(field);
    }

    // Defaults not supported for repeated fields
    if (field.repeated) {
        delete options.default;
    }
}

function buildDefaults(ctx, syntax) {
    var proto = ctx._proto;

    for (var i = 0; i < ctx._children.length; i++) {
        buildDefaults(ctx._children[i], syntax);
    }

    if (proto.fields) {
        for (i = 0; i < proto.fields.length; i++) {
            setDefaultValue(ctx, proto.fields[i], syntax);
        }
    }

    return ctx;
}

function getDefaultWriteTest(ctx, field) {
    var def = field.options.default;
    var type = getType(ctx, field);
    var code = '    if (obj.' + field.name;

    if (!field.repeated && (!type || !type._proto.fields)) {
        if (def === undefined || def) {
            code += ' != undefined';
        }

        if (def) {
            code += ' && obj.' + field.name + ' !== ' + JSON.stringify(def);
        }
    }

    return code + ') ';
}

function isPacked(field) {
    return field.options.packed === 'true';
}
