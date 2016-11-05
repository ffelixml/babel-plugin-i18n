class PathNotFoundError extends Error {
  constructor(keypath, failingPart) {
    super(`Keypath '${keypath}' did not resolve to any translation at path '${failingPart}'`);
  }
}

class KeypathTypeError extends Error {
  constructor(keypath, translation, expectedType) {
    const actualType = typeof translation;
    const expectErr =
      Array.isArray(expectedType)
      ? `Expected ['${expectedType.join("', '")}']`
      : `Expected '${expectedType}'`;
    super(`Keypath '${keypath}' was of incorrect type. ${expectErr}, was '${actualType}'`);
  }
}

function resolveKeypath(keypath, translations) {
  return keypath.split('.').reduce((previous, current) => {
    const nextChild = previous[current];
    if (nextChild === undefined) {
      throw new PathNotFoundError(keypath, current);
    }
    return nextChild;
  }, translations);
}

function getKeypath(path) {
  const translationArguments = path.node.arguments;
  if (translationArguments.length !== 1) {
    throw path.buildCodeFrameError('Translating requires one argument exactly');
  }
  const keypathArg = translationArguments[0];
  if (keypathArg.type !== 'StringLiteral') {
    throw path.buildCodeFrameError('Only strings can be used for translation');
  }
  return keypathArg.value;
}

function getAstLiteralForTranslation(t, keypath, translation) {
  if (translation === null) {
    return t.NullLiteral();
  }
  switch (typeof translation) {
    case 'string':
      return t.StringLiteral(translation);
    case 'number':
      return t.NumericLiteral(translation);
    case 'boolean':
      return t.BooleanLiteral(translation);
    default:
      throw new KeypathTypeError(
        keypath,
        translation,
        ['string', 'number', 'null', 'boolean']
      );
  }
}

function replaceKeypathWithString(t, path, translations) {
  const keypath = getKeypath(path);

  try {
    const translation = resolveKeypath(keypath, translations);
    const literal = getAstLiteralForTranslation(t, keypath, translation);
    path.replaceWith(literal);
  } catch (ex) {
    throw path.buildCodeFrameError(ex);
  }
}

function replaceKeypathWithObject(t, path, translations) {
  const keypath = getKeypath(path);

  try {
    const translation = resolveKeypath(keypath, translations);
    if (typeof translation !== 'object') {
      throw new KeypathTypeError(keypath, translation, 'object');
    }
    const objProperties = createObjectPropertiesForTranslation(t, keypath, translation);
    path.replaceWith(t.ObjectExpression(objProperties));
  } catch (ex) {
    throw path.buildCodeFrameError(ex);
  }
}

function astLiteralOrDeepObject(t, keypath, value) {
  if (Array.isArray(value)) {
    return value.map(item => astLiteralOrDeepObject(t, keypath, item));
  } else if (value !== null && typeof value === 'object') {
    return createObjectPropertiesForTranslation(t, keypath, value);
  }
  return getAstLiteralForTranslation(t, keypath, value);
}

function createObjectPropertiesForTranslation(t, keypath, translation) {
  return Object.keys(translation).map(key => {
    const value = translation[key];
    if (Array.isArray(value)) {
      const elements = value.map(item => astLiteralOrDeepObject(t, keypath, item));
      return t.ObjectProperty(
        t.Identifier(key),
        t.ArrayExpression(elements)
      );
    } else if (value !== null && typeof value === 'object') {
      return t.ObjectProperty(
        t.Identifier(key),
        t.ObjectExpression(createObjectPropertiesForTranslation(t, keypath, value))
      );
    }
    const literal = getAstLiteralForTranslation(t, keypath, value);
    return t.ObjectProperty(
      t.Identifier(key),
      literal
    );
  });
}

module.exports = function translatePlugin({types: t}) {
  return {
    visitor: {
      CallExpression(path, { opts: { translations } }) {
        const funcName = path.node.callee.name;
        if (funcName === '__') {
          replaceKeypathWithString(t, path, translations);
        } else if (funcName === '__obj') {
          replaceKeypathWithObject(t, path, translations);
        }
      },
    },
  };
};
