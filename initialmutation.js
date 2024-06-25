const puppeteer = require("puppeteer");

const TreeMirror = require("./tree-mirror.js");

async function Run() {
  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  console.log("Browser", browser.connected);
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(600000);

  await page.goto("https://thejellybee.com");

  //await page.waitForNavigation();

  let getInitialMutation = function () {
    console.log("Evaluating .... ");
    return page.evaluate(() => {

      function NodeMap() {
        this.nodes = new Map();
      }
      
      NodeMap.prototype.set = function(node, value) {
        this.nodes.set(node, value);
      };
      
      NodeMap.prototype.get = function(node) {
        return this.nodes.get(node);
      };
      
      NodeMap.prototype.delete = function(node) {
        this.nodes.delete(node);
      };
      
      NodeMap.prototype.has = function(node) {
        return this.nodes.has(node);
      };
      
      NodeMap.prototype.keys = function() {
        return Array.from(this.nodes.keys());
      };
      
      NodeMap.prototype.values = function() {
        return Array.from(this.nodes.values());
      };
      
      NodeMap.prototype.forEach = function(callback) {
        this.nodes.forEach((value, key) => {
          callback(value, key);
        });
      };

      function MutationSummary(config) {
        this.rootNode = config.rootNode;
        this.callback = config.callback;
        this.queries = config.queries || [{ all: true }];
        this.observer = new MutationObserver(this.handleMutations.bind(this));
        this.observe();
      }
      
      MutationSummary.prototype.observe = function() {
        const options = {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        };
        this.observer.observe(this.rootNode, options);
      };
      
      MutationSummary.prototype.handleMutations = function(mutations) {
        const summaries = this.summarize(mutations);
        if (summaries.length > 0) {
          this.callback(summaries);
        }
      };
      
      MutationSummary.prototype.summarize = function(mutations) {
        const summary = {
          added: [],
          removed: [],
          reparented: [],
          reordered: [],
          attributeChanged: {},
          characterDataChanged: []
        };
      
        mutations.forEach(mutation => {
          switch (mutation.type) {
            case 'childList':
              mutation.addedNodes.forEach(node => summary.added.push(node));
              mutation.removedNodes.forEach(node => summary.removed.push(node));
              break;
            case 'attributes':
              if (!summary.attributeChanged[mutation.attributeName]) {
                summary.attributeChanged[mutation.attributeName] = [];
              }
              summary.attributeChanged[mutation.attributeName].push(mutation.target);
              break;
            case 'characterData':
              summary.characterDataChanged.push(mutation.target);
              break;
          }
        });
      
        return [summary];
      };
      
      MutationSummary.prototype.disconnect = function() {
        this.observer.disconnect();
      };

      


      var TreeMirrorClient = (function() {
        function TreeMirrorClient(target, mirror, testingQueries) {
          var _this = this;
          this.target = target;
          this.mirror = mirror;
          this.nextId = 1;
          this.knownNodes = new NodeMap();
          this.changes = { removed: [], moved: [], attributes: [], text: [] };
          var rootId = this.serializeNode(target).id;
          var children = [];
          for (var child = target.firstChild; child; child = child.nextSibling)
            children.push(this.serializeNode(child, true));

          return this.mirror.initialize(rootId, children);
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

          return children;
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
              data.textContent = node.textContent;
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
          var parentMap = new NodeMap();
          all.forEach(function(node) {
            var parent = node.parentNode;
            var children = parentMap.get(parent);
            if (!children) {
              children = new NodeMap();
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
          var map = new NodeMap();
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
            data.textContent = node.textContent;
            return data;
          });
      
          this.changes = { removed, moved, attributes, text };
      
          this.mirror.applyChanged(removed, moved, attributes, text);
          summary.removed.forEach(function(node) {
            _this.forgetNode(node);
          });
        };
      
        TreeMirrorClient.prototype.getChanges = function() {
          return this.changes;
        };
      
        return TreeMirrorClient;
      })();
      

    
      return new TreeMirrorClient(document, {
        initialize: function (aQ, aR) {
          var aS = {
            ty: 5,
            ti: 0,
            te: JSON.stringify({
              rootId: aQ,
              children: aR,
            }),
          };
        //   if (!ak.initialDOM) {
        //     ak.initialDOM = aS.te;
        //     typeof heatmapDebugger !== "undefined"
        //       ? heatmapDebugger.updateDomSerialization("sessionRecording", 1)
        //       : null;
        //   }
          //z.recordData(c, aS);
          return aS;
        },
        applyChanged: function (aT, aR, aQ, aU) {
          if (aT.length || aR.length || aQ.length || aU.length) {
            var aS = {
              ti: au.getTimeSincePageReady(),
              ty: ag,
              te: {},
            };
            if (aT.length) {
              aS.te.rem = aT;
            }
            if (aR.length) {
              aS.te.adOrMo = aR;
            }
            if (aQ.length) {
              aS.te.att = aQ;
            }
            if (aU.length) {
              aS.te.text = aU;
            }
            aS.te = JSON.stringify(aS.te);
            z.recordData(c, aS);
          }
        },
      });
    });
  };

  return getInitialMutation();
}

Run()
  .then((initialMutation) => {
    debugger;
    console.log("InitialMutation", initialMutation);
  })
  .catch((error) => {
    console.log("Error in Run", error);
  });
