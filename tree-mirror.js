/**
 * Custom changes by innocraft:
 * Around line 90 and 60 added this block in try catch:
 *  try { node.setAttribute(name, nodeData.attributes[name]); } catch (e) { }
 *  because we had some websites where eg a name is '"' and then browser fails with error invalid name
 *
 * We also applied some custom changes to make sure objects are actually set to prevent random errors. Eg
 * if (node.parentNode) => if (node && node.parentNode)
 * as we experienced random errors there where for some reason an object is not defined and then no page is being rendered
 * because of a JS error
 *
 * we also removed a possible exception / error to make sure we don't stop rendering the page in case something goes wrong
 */


var TreeMirror = (function() {
  function TreeMirror(root, delegate) {
    this.root = root;
    this.delegate = delegate;
    this.idMap = {};
  }
  TreeMirror.prototype.initialize = function(rootId, children) {
    this.idMap[rootId] = this.root;
    for (var i = 0; i < children.length; i++) this.deserializeNode(children[i], this.root);
  };
  TreeMirror.prototype.applyChanged = function(removed, addedOrMoved, attributes, text) {
    var _this = this;
    // NOTE: Applying the changes can result in an attempting to add a child
    // to a parent which is presently an ancestor of the parent. This can occur
    // based on random ordering of moves. The way we handle this is to first
    // remove all changed nodes from their parents, then apply.
    addedOrMoved.forEach(function(data) {
      var node = _this.deserializeNode(data);
      var parent = _this.deserializeNode(data.parentNode);
      var previous = _this.deserializeNode(data.previousSibling);
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    removed.forEach(function(data) {
      var node = _this.deserializeNode(data);
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    addedOrMoved.forEach(function(data) {
      var node = _this.deserializeNode(data);
      var parent = _this.deserializeNode(data.parentNode);
      var previous = _this.deserializeNode(data.previousSibling);
      if (node && parent) {
        try {
          parent.insertBefore(node, previous ? previous.nextSibling : parent.firstChild);
        } catch (e) {
          console.log(e);
        }
      }
    });
    attributes.forEach(function(data) {
      var node = _this.deserializeNode(data);
      if (node) {
        Object.keys(data.attributes).forEach(function(attrName) {
          var newVal = data.attributes[attrName];
          if (newVal === null) {
            try {
              node.removeAttribute(attrName);
            } catch (e) {
              console.log(e);
            }
          } else {
            if (
              !_this.delegate ||
              !_this.delegate.setAttribute ||
              !_this.delegate.setAttribute(node, attrName, newVal)
            ) {
              try {
                node.setAttribute(attrName, newVal);
              } catch (e) {}
            }
          }
        });
      }
    });
    text.forEach(function(data) {
      var node = _this.deserializeNode(data);
      if (node) {
        node.textContent = data.textContent;
      }
    });
    removed.forEach(function(node) {
      delete _this.idMap[node.id];
    });
  };
  // for cases where decodeURIComponent throws funny errors
  const customDecode = (str) => {
    if(!str) return str;
    const specialCharactersMap = new Map([
      ['%09', '\t'],
      ['%0A', '\n'],
      ['%0D', '\r'],
      ['%20', ' '],
      ['%21', '!'],
      ['%22', '"'],
      ['%23', '#'],
      ['%24', '$'],
      ['%25', '%'],
      ['%26', '&'],
      ['%27', "'"],
      ['%28', '('],
      ['%29', ')'],
      ['%2A', '*'],
      ['%2B', '+'],
      ['%2C', ','],
      ['%2D', '-'],
      ['%2E', '.'],
      ['%2F', '/'],
      ['%3A', ':'],
      ['%3B', ';'],
      ['%3C', '<'],
      ['%3D', '='],
      ['%3E', '>'],
      ['%3F', '?'],
      ['%40', '@'],
      ['%5B', '['],
      ['%5C', '\\'],
      ['%5D', ']'],
      ['%5E', '^'],
      ['%5F', '_'],
      ['%60', '`'],
      ['%7B', '{'],
      ['%7C', '|'],
      ['%7D', '}'],
      ['%7E', '~']
    ]);

    // Array to hold the original background-image:url segments
    const placeholders = [];
    const regex = /:url\((?:\\"|")?([^)]+)(?:\\"|")?\)/g;

    // Temporarily replace matches with placeholders
    str = str.replace(regex, match => {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(match);
      return placeholder;
    });

    // Decode the rest of the string
    [...specialCharactersMap.keys()].forEach(schar => {
      str = str.replaceAll(schar, specialCharactersMap.get(schar));
    });

    // Restore the original segments
    placeholders.forEach((placeholder, index) => {
      str = str.replace(`__PLACEHOLDER_${index}__`, placeholders[index]);
    });

    return str;
  };

  TreeMirror.prototype.deserializeNode = function(nodeData, parent) {
    var _this = this;
    if (!nodeData) return null;
    var node = this.idMap[nodeData.id];
    if (node) return node;
    var doc = this.root.ownerDocument;
    if (!doc) doc = this.root;
    switch (nodeData.nodeType) {
      case Node.COMMENT_NODE:
        node = doc.createComment(customDecode(nodeData.textContent) || "");
        break;
      case Node.TEXT_NODE:
        node = doc.createTextNode(customDecode(nodeData.textContent) || "");
        break;
      case Node.DOCUMENT_TYPE_NODE:
        node = doc.implementation.createDocumentType(
          nodeData.name,
          nodeData.publicId,
          nodeData.systemId
        );
        break;
      case Node.ELEMENT_NODE:
        if (this.delegate && this.delegate.createElement)
          node = this.delegate.createElement(nodeData.tagName, nodeData);
        if (!node) node = doc.createElement(nodeData.tagName.replace("<", ""));
        if (!node) node = doc.createElement(nodeData.tagName);

        if ("undefined" !== typeof nodeData.attributes) {
          Object.keys(nodeData.attributes).forEach(function(name) {
            if (
              !_this.delegate ||
              !_this.delegate.setAttribute ||
              !_this.delegate.setAttribute(node, name, nodeData.attributes[name])
            ) {
              try {
                node.setAttribute(name, nodeData.attributes[name]);
              } catch (e) {}
            }
          });
        }
        break;
    }
    if (!node) return;
    this.idMap[nodeData.id] = node;
    if (parent) {
      if (node instanceof HTMLElement && typeof node.hasAttribute === "function") {
        if (node.tagName.toLowerCase() === "iframe") node.setAttribute("sandbox", "");
        /* if (
          !(
            ((node.getAttribute("rel") === "prefetch" || node.getAttribute("rel") === "preload") &&
              node.getAttribute("as") === "script") ||
            (node.getAttribute("href") && node.getAttribute("href").includes(".js"))
          )
        ) {
          parent.appendChild(node);
        }*/
        parent.appendChild(node);
      } else {
        parent.appendChild(node);
      }
    }
    if (nodeData.childNodes) {
      for (var i = 0; i < nodeData.childNodes.length; i++) {
        try {
          this.deserializeNode(nodeData.childNodes[i], node);
        } catch (e) {}
      }
    }
    return node;
  };

  return TreeMirror;
  
})();

var TreeMirrorClient = (function() {
  function TreeMirrorClient(target, mirror, testingQueries) {
    var _this = this;
    this.target = target;
    this.mirror = mirror;
    this.nextId = 1;
    this.knownNodes = new MutationSummary.NodeMap();
    var rootId = this.serializeNode(target).id;
    var children = [];
    for (var child = target.firstChild; child; child = child.nextSibling)
      children.push(this.serializeNode(child, true));
    this.mirror.initialize(rootId, children);
    var self = this;
    var queries = [{ all: true }];
    if (testingQueries) queries = queries.concat(testingQueries);
    this.mutationSummary = new MutationSummary({
      rootNode: target,
      callback: function(summaries) {
        _this.applyChanged(summaries);
      },
      queries: queries
    });
  }
  TreeMirrorClient.prototype.disconnect = function() {
    if (this.mutationSummary) {
      this.mutationSummary.disconnect();
      this.mutationSummary = undefined;
    }
  };
  TreeMirrorClient.prototype.rememberNode = function(node) {
    var id = this.nextId++;
    this.knownNodes.set(node, id);
    return id;
  };
  TreeMirrorClient.prototype.forgetNode = function(node) {
    this.knownNodes.delete(node);
  };
  TreeMirrorClient.prototype.serializeNode = function(node, recursive) {
    if (node === null) return null;
    var id = this.knownNodes.get(node);
    if (id !== undefined) {
      return { id: id };
    }
    var data = {
      nodeType: node.nodeType,
      id: this.rememberNode(node)
    };
    switch (data.nodeType) {
      case Node.DOCUMENT_TYPE_NODE:
        var docType = node;
        data.name = docType.name;
        data.publicId = docType.publicId;
        data.systemId = docType.systemId;
        break;
      case Node.COMMENT_NODE:
      case Node.TEXT_NODE:
        data.textContent = decodeURIComponent(node.textContent);
        break;
      case Node.ELEMENT_NODE:
        var elm = node;
        data.tagName = elm.tagName;
        data.attributes = {};
        for (var i = 0; i < elm.attributes.length; i++) {
          var attr = elm.attributes[i];
          data.attributes[attr.name] = attr.value;
        }
        if (recursive && elm.childNodes.length) {
          data.childNodes = [];
          for (var child = elm.firstChild; child; child = child.nextSibling)
            data.childNodes.push(this.serializeNode(child, true));
        }
        break;
    }
    return data;
  };
  TreeMirrorClient.prototype.serializeAddedAndMoved = function(added, reparented, reordered) {
    var _this = this;
    var all = added.concat(reparented).concat(reordered);
    var parentMap = new MutationSummary.NodeMap();
    all.forEach(function(node) {
      var parent = node.parentNode;
      var children = parentMap.get(parent);
      if (!children) {
        children = new MutationSummary.NodeMap();
        parentMap.set(parent, children);
      }
      children.set(node, true);
    });
    var moved = [];
    parentMap.keys().forEach(function(parent) {
      var children = parentMap.get(parent);
      var keys = children.keys();
      while (keys.length) {
        var node = keys[0];
        while (node.previousSibling && children.has(node.previousSibling))
          node = node.previousSibling;
        while (node && children.has(node)) {
          var data = _this.serializeNode(node);
          data.previousSibling = _this.serializeNode(node.previousSibling);
          data.parentNode = _this.serializeNode(node.parentNode);
          moved.push(data);
          children.delete(node);
          node = node.nextSibling;
        }
        var keys = children.keys();
      }
    });
    return moved;
  };
  TreeMirrorClient.prototype.serializeAttributeChanges = function(attributeChanged) {
    var _this = this;
    var map = new MutationSummary.NodeMap();
    Object.keys(attributeChanged).forEach(function(attrName) {
      attributeChanged[attrName].forEach(function(element) {
        var record = map.get(element);
        if (!record) {
          record = _this.serializeNode(element);
          record.attributes = {};
          map.set(element, record);
        }
        record.attributes[attrName] = element.getAttribute(attrName);
      });
    });
    return map.keys().map(function(node) {
      return map.get(node);
    });
  };
  TreeMirrorClient.prototype.applyChanged = function(summaries) {
    var _this = this;
    var summary = summaries[0];
    var removed = summary.removed.map(function(node) {
      return _this.serializeNode(node);
    });
    var moved = this.serializeAddedAndMoved(summary.added, summary.reparented, summary.reordered);
    var attributes = this.serializeAttributeChanges(summary.attributeChanged);
    var text = summary.characterDataChanged.map(function(node) {
      var data = _this.serializeNode(node);
      data.textContent = decodeURIComponent(node.textContent);
      return data;
    });
    this.mirror.applyChanged(removed, moved, attributes, text);
    summary.removed.forEach(function(node) {
      _this.forgetNode(node);
    });
  };
  return TreeMirrorClient;
})();

module.exports = TreeMirror;