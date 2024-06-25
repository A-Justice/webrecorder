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
      

      var TreeMirrorClient = (function() {
        function TreeMirrorClient(target, mirror, testingQueries) {
          var _this = this;
          this.target = target;
          this.mirror = mirror;
          this.nextId = 1;
          this.knownNodes = new NodeMap();
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
          return this.mutationSummary;
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
      
      

      function addRemoveSupport(window) {
        if (window && !("remove" in window.Element.prototype)) {
          window.Element.prototype.remove = function () {
            if (this.parentNode && this.parentNode.removeChild) {
              this.parentNode.removeChild(this);
            }
          };
        }
      }

      if (document.documentElement) {
        document.documentElement.remove();
      }

      if (document && document.doctype) {
        if (document.doctype && document.doctype.remove) {
          document.doctype.remove();
        } else if (document.doctype) {
          // fix remove is not available on IE
          document.removeChild(document.doctype);
        }
      }

      addRemoveSupport(window);

      //   return new TreeMirror(document, {
      //     createElement: function (tagName, data) {
      //       if (!tagName) {
      //         return;
      //       }

      //       tagName = tagName.toLowerCase().trim();

      //       if (tagName === "script") {
      //         // prevent execution of this element! we still need to have it in the dom eg for nth-child selector etc.
      //         var element = document.createElement("NO_SCRIPT");
      //         element.style.display = "none";
      //         return element;
      //       } else if (tagName === "form") {
      //         var element = document.createElement("FORM");
      //         element.addEventListener("submit", function (event) {
      //           event.preventDefault();
      //           event.stopPropagation();
      //           return false;
      //         });
      //         return element;
      //       } else if (
      //         tagName === "link" ||
      //         tagName === "img" ||
      //         tagName === "iframe"
      //       ) {
      //         var element;
      //         var isLinkHrefAttr =
      //           tagName === "link" && data && typeof data.attributes === "object";
      //         function shouldUnresolve(href) {
      //           var posHref = href
      //             .toLowerCase()
      //             .indexOf(".scr.kaspersky-labs.com");
      //           if (posHref > 5 && posHref < 20) {
      //             return true;
      //           }
      //           return false;
      //         }
      //         if (
      //           tagName === "iframe" &&
      //           "src" in data.attributes &&
      //           data.attributes.src.indexOf("google.com/recaptcha") !== -1
      //         ) {
      //           var element = document.createElement("NO_SCRIPT");
      //           element.style.display = "none";
      //           return element;
      //         }
      //         if (
      //           isLinkHrefAttr &&
      //           "href" in data.attributes &&
      //           data.attributes["href"]
      //         ) {
      //           if (shouldUnresolve(String(data.attributes["href"]))) {
      //             data.attributes["href"] = "#not_possible_to_resolve";
      //             // this URL cannot be resolved and is injected dynamically
      //             element = document.createElement("NO_LINK");
      //             element.style.display = "none";
      //           }
      //         }
      //         if (
      //           isLinkHrefAttr &&
      //           "data-matomo-href" in data.attributes &&
      //           data.attributes["data-matomo-href"]
      //         ) {
      //           if (
      //             shouldUnresolve(String(data.attributes["data-matomo-href"]))
      //           ) {
      //             data.attributes["href"] = "#not_possible_to_resolve";
      //             // this URL cannot be resolved and is injected dynamically
      //             element = document.createElement("NO_LINK");
      //             element.style.display = "none";
      //           } else {
      //             data.attributes["href"] = data.attributes["data-matomo-href"];
      //           }
      //         }

      //         if (!element) {
      //           element = document.createElement(tagName.toUpperCase());
      //         }

      //         if (element.tagName === "IFRAME") {
      //           element.setAttribute("sandbox", "allow-scripts");
      //         }

      //         element.setAttribute("referrerpolicy", "no-referrer");
      //         return element;
      //       } else if (tagName === "head") {
      //         var element = document.createElement("HEAD");

      //         // we need to add ours first, because multiple base elements may exist and their base might only
      //         // appear after few resources are already loaded
      //         element.appendChild(document.createElement("BASE"));
      //         element.firstChild.href = baseUrl;

      //         var style = document.createElement("style");
      //         style.setAttribute("type", "text/css");
      //         style.appendChild(
      //           document.createTextNode(
      //             "[data-matomo-mask] {background-image: none !important; }" +
      //               ' img[data-matomo-mask][src^="http"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src^="/"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src*=".png"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src*=".jpg"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src*=".webp"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src*=".jepg"] {visibility:hidden !important;opacity: 0; }' +
      //               ' img[data-matomo-mask][src*=".gif"] {visibility:hidden !important;opacity: 0; }'
      //           )
      //         );
      //         element.appendChild(style);
      //         element.appendChild(document.createElement("BASE"));

      //         var metaElement = document.createElement("META");
      //         metaElement.name = "referrer";
      //         metaElement.content = "no-referrer";
      //         element.appendChild(metaElement);

      //         if (
      //           typeof data === "object" &&
      //           "childNodes" in data &&
      //           data.childNodes &&
      //           data.childNodes.length
      //         ) {
      //           for (var k = 0; k < data.childNodes.length; k++) {
      //             if (
      //               k in data.childNodes &&
      //               "object" === typeof data.childNodes[k] &&
      //               "tagName" in data.childNodes[k] &&
      //               data.childNodes[k].tagName &&
      //               data.childNodes[k].tagName === "BASE"
      //             ) {
      //               if (
      //                 "attributes" in data.childNodes[k] &&
      //                 data.childNodes[k].attributes &&
      //                 data.childNodes[k].attributes.href
      //               ) {
      //                 // no need to add a BASE ourselves, we prefer to use existing base set by user

      //                 var thisBaseUrl = data.childNodes[k].attributes.href;

      //                 var lowerThisBaseUrl = ("" + thisBaseUrl).toLowerCase();
      //                 if (
      //                   lowerThisBaseUrl.indexOf("http") === 0 ||
      //                   lowerThisBaseUrl.indexOf("//") === 0
      //                 ) {
      //                   // absolute base URL is set, we can simply use that URL
      //                   continue; // there might be multiple base URLs so need to continue
      //                 }

      //                 // it has to be a relative URL, trying to resolve it
      //                 if ("function" === typeof URL) {
      //                   var theUrl = new URL(thisBaseUrl, baseUrl);
      //                   if (theUrl && theUrl.href) {
      //                     baseUrl = theUrl.href;
      //                   } else if (theUrl) {
      //                     baseUrl = "" + theUrl;
      //                   }
      //                 } else {
      //                   // browser does not support URL api... won't work in IE11 or lower
      //                   if (
      //                     "undefined" !== typeof console &&
      //                     "undefined" !== typeof console.log
      //                   ) {
      //                     console.log(
      //                       "browser does not support URL api, cannot resolve relative base URL"
      //                     );
      //                   }
      //                 }

      //                 // make sure to use this absolute base url
      //                 data.childNodes[k].attributes.href = baseUrl;
      //                 continue; // there might be multiple base URLs so need to continue
      //               }
      //             }
      //           }
      //         }

      //         return element;
      //       } else if (tagName === "a") {
      //         var element = document.createElement("A");
      //         element.addEventListener("click", function (event) {
      //           event.preventDefault();
      //           event.stopPropagation();
      //           return false;
      //         });
      //         return element;
      //       } else if (
      //         [
      //           "svg",
      //           "path",
      //           "g",
      //           "polygon",
      //           "polyline",
      //           "rect",
      //           "text",
      //           "circle",
      //           "line",
      //         ].indexOf(tagName) !== -1
      //       ) {
      //         return document.createElementNS(
      //           "http://www.w3.org/2000/svg",
      //           tagName
      //         );
      //       } else if (tagName === "meta") {
      //         if (data && typeof data.attributes === "object") {
      //           if (
      //             "http-equiv" in data.attributes &&
      //             data.attributes["http-equiv"]
      //           ) {
      //             var httpEquiv = String(
      //               data.attributes["http-equiv"]
      //             ).toLowerCase();

      //             if (
      //               httpEquiv === "content-security-policy" ||
      //               httpEquiv === "refresh"
      //             ) {
      //               return document.createElement("NO_META");
      //             }
      //           }
      //           if ("name" in data.attributes && data.attributes["name"]) {
      //             var metaName = String(data.attributes["name"]).toLowerCase();
      //             if (metaName === "csrf-token") {
      //               return document.createElement("NO_META");
      //             }
      //             if (metaName === "referrer") {
      //               // we want to apply our own policy
      //               return document.createElement("NO_META");
      //             }
      //           }
      //         }
      //       }
      //     },
      //     setAttribute: function (node, name, value) {
      //       if (!name) {
      //         return node;
      //       }

      //       var nameLower = String(name).trim().toLowerCase();

      //       if (
      //         nameLower === "src" &&
      //         value &&
      //         (String(value).indexOf("/piwik.js") >= 0 ||
      //           String(value).indexOf("/matomo.js") >= 0)
      //       ) {
      //         // we do not want to set piwik.js
      //         return node;
      //       }

      //       if (nameLower === "srcdoc") {
      //         // we ignore srcdoc
      //         return node;
      //       }

      //       if (nameLower === "referrerpolicy") {
      //         // we always set our value
      //         node.setAttribute(nameLower, "no-referrer");
      //         return node;
      //       }

      //       if (
      //         nameLower === "src" &&
      //         value &&
      //         String(value).indexOf("/HeatmapSessionRecording/") > 0
      //       ) {
      //         // we do not want to set configs.php etc
      //         return node;
      //       }

      //       if (
      //         value &&
      //         (String(value)
      //           .toLowerCase()
      //           .replace(/\x09|\x0a|\x0d/g, "")
      //           .indexOf("javascript") >= 0 ||
      //           String(value)
      //             .toLowerCase()
      //             .replace(/\x09|\x0a|\x0d/g, "")
      //             .indexOf("ecmascript") >= 0 ||
      //           String(value)
      //             .toLowerCase()
      //             .replace(/\x09|\x0a|\x0d/g, "")
      //             .indexOf("vbscript") >= 0 ||
      //           String(value)
      //             .toLowerCase()
      //             .replace(/\x09|\x0a|\x0d/g, "")
      //             .indexOf("jscript") >= 0)
      //       ) {
      //         // we do not want to set any javascript URL, eg href and src and attribute
      //         return node;
      //       }
      //       if (
      //         value &&
      //         String(value).toLowerCase().indexOf("xmlhttprequest") >= 0
      //       ) {
      //         // prevent simple input of xmlhttprequest
      //         return node;
      //       }
      //       if (value && /fetch\s*\(/.test(String(value).toLowerCase())) {
      //         // prevent simple input of fetch(
      //         return node;
      //       }

      //       var blockedAttributes = [
      //         "onchange",
      //         "onload",
      //         "onshow",
      //         "onhashchange",
      //         "onstorage",
      //         "onchecking",
      //         "ondownloading",
      //         "onnoupdate",
      //         "onupdateready",
      //         "onabort",
      //         "oncopy",
      //         "ondrop",
      //         "onwheel",
      //         "onpaste",
      //         "oncut",
      //         "onbeforeunload",
      //         "onreset",
      //         "onsubmit",
      //         "onunload",
      //         "onerror",
      //         "onclose",
      //         "onopen",
      //         "onpagehide",
      //         "onpageshow",
      //         "onpopstate",
      //         "onmessage",
      //         "onclick",
      //         "ondblclick",
      //         "oncontextmenu",
      //         "onauxclick",
      //         "onfocus",
      //         "onfocusin",
      //         "onfocusout",
      //         "onblur",
      //         "onselect",
      //         "onplay",
      //         "onpause",
      //         "onended",
      //         "onsuspend",
      //         "onwaiting",
      //         "onprogress",
      //         "ontimeout",
      //         "onchange",
      //         "ontimeupdate",
      //         "onstalled",
      //         "onseeking",
      //         "onplaying",
      //         "onloadeddata",
      //         "onended",
      //         "onemptied",
      //         "ondurationchange",
      //         "oncanplay",
      //         "oncomplete",
      //         "onaudioprocess",
      //       ];
      //       // we block any on... per regex but adding few other checks just in case the regex fails
      //       if (
      //         /^on([a-zA-Z])+$/.test(nameLower) ||
      //         blockedAttributes.indexOf(nameLower) > -1 ||
      //         nameLower.indexOf("onmouse") === 0 ||
      //         nameLower.indexOf("onkey") === 0 ||
      //         nameLower.indexOf("onanimation") === 0 ||
      //         nameLower.indexOf("ondrag") === 0 ||
      //         nameLower.indexOf("onload") === 0 ||
      //         nameLower.indexOf("ontransition") === 0 ||
      //         nameLower.indexOf("oncomposition") === 0 ||
      //         nameLower.indexOf("ontouch") === 0
      //       ) {
      //         // do not execute any onload method or when we set form element values
      //         return node;
      //       }

      //       if (node.tagName === "LINK") {
      //         if (nameLower === "crossorigin") {
      //           // cross origin relevant for images only, not for scripts as we rename them anyway
      //           return node;
      //         }

      //         if (nameLower === "integrity") {
      //           // hash of a file should be ignored as file fetched later might have different hash etc
      //           return node;
      //         }

      //         if (nameLower === "referrerpolicy") {
      //           // do not overwrite our policy
      //           return node;
      //         }

      //         if (requireSecureProtocol) {
      //           if (
      //             nameLower === "href" &&
      //             value &&
      //             String(value).indexOf("http:") === 0
      //           ) {
      //             value = convertUrlToSecureProtocolIfNeeded(value);
      //             node.setAttribute(name, value);
      //             return node;
      //           }
      //         }
      //       }

      //       function addPrefetchToHead(src) {
      //         const prefetchLink = document.createElement("link");

      //         prefetchLink.rel = "prefetch";
      //         prefetchLink.href = src;

      //         document.head.appendChild(prefetchLink);
      //       }

      //       if (node.tagName === "IMG") {
      //         var isHeatmap = window.location.search.indexOf("idLogHsr") === -1;
      //         //To support images rendered using lazy load, we check if allowed dataset attributes are set and no src attributes are present replace it with available data attributes
      //         if (
      //           isHeatmap &&
      //           (typeof node.attributes.src === "undefined" ||
      //             node.getAttribute("src") === "") &&
      //           Object.keys(node.dataset).length
      //         ) {
      //           var allowedDatasetsToReplaceImageSrc = [
      //             "src",
      //             "original",
      //             "lazy",
      //           ];
      //           var newSrcValue = "";
      //           for (
      //             var i = 0;
      //             i < allowedDatasetsToReplaceImageSrc.length;
      //             i++
      //           ) {
      //             if (
      //               typeof node.dataset[allowedDatasetsToReplaceImageSrc[i]] !==
      //                 "undefined" &&
      //               node.dataset[allowedDatasetsToReplaceImageSrc[i]]
      //             ) {
      //               newSrcValue =
      //                 node.dataset[allowedDatasetsToReplaceImageSrc[i]];
      //               break;
      //             }
      //           }

      //           //srcset is also used to lazy load with responsive images
      //           //the value of srcset is "{imagePath} screenSize1,{imagePath} screenSize2" for responsive lazy load
      //           //Eg data-scrset="images/400.jpg 400w, images/400.webp 400w, images/600.jpg 600w"
      //           //we pick the last size and to determine it by checking the last character has w
      //           // if we cannot find last character as 'w' we just set the src else we replace with the last size determined
      //           if (
      //             newSrcValue === "" &&
      //             typeof node.dataset.srcset !== "undefined" &&
      //             node.dataset.srcset
      //           ) {
      //             var srcSetValue = node.dataset.srcset;
      //             var srcSetLength = srcSetValue.length;
      //             if (srcSetValue[srcSetLength - 1] === "w") {
      //               var splitSrcSetSizes = srcSetValue.split("w,");
      //               var lastSizeValue =
      //                 splitSrcSetSizes[splitSrcSetSizes.length - 1];
      //               newSrcValue = lastSizeValue.replace(/ \d+w/g, "").trim();
      //             } else {
      //               newSrcValue = srcSetValue;
      //             }
      //           }
      //           if (newSrcValue) {
      //             addPrefetchToHead(newSrcValue);
      //             if (node.getAttribute("data-src")) {
      //               node.setAttribute("src", node.getAttribute("data-src"));
      //               node.removeAttribute("data-src"); //use only if you need to remove data-src attribute after setting src
      //             } else {
      //               node.setAttribute(
      //                 "src",
      //                 convertUrlToSecureProtocolIfNeeded(newSrcValue)
      //               );
      //             }
      //           }
      //         }

      //         if (requireSecureProtocol) {
      //           if (
      //             nameLower === "src" &&
      //             value &&
      //             String(value).indexOf("http:") === 0
      //           ) {
      //             value = convertUrlToSecureProtocolIfNeeded(value);
      //             node.setAttribute(name, value);
      //             return node;
      //           }
      //         }

      //         if (nameLower === "referrerpolicy") {
      //           // do not overwrite our policy
      //           return node;
      //         }
      //       }

      //       if (node.tagName === "FORM") {
      //         if (requireSecureProtocol) {
      //           if (
      //             nameLower === "action" &&
      //             value &&
      //             String(value).indexOf("http:") === 0
      //           ) {
      //             value = convertUrlToSecureProtocolIfNeeded(value);
      //             node.setAttribute(name, value);
      //             return node;
      //           }
      //         }
      //       }

      //       if (node.tagName === "IFRAME") {
      //         var youtubeRegex =
      //           /^((?:https?:)\/\/)((?:www|m)\.)?((?:youtube\.com|youtube-nocookie\.com|youtu\.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)([a-zA-Z_=&]*)?$/;
      //         if (node.src && youtubeRegex.test(node.src.toLowerCase())) {
      //           node.setAttribute("sandbox", "allow-scripts allow-same-origin");
      //         } else {
      //           node.setAttribute("sandbox", "allow-scripts");
      //         }

      //         if (requireSecureProtocol) {
      //           if (
      //             nameLower === "src" &&
      //             value &&
      //             String(value).indexOf("http:") === 0
      //           ) {
      //             value = convertUrlToSecureProtocolIfNeeded(value);
      //             node.setAttribute(name, value);
      //             return node;
      //           }
      //         }

      //         if (nameLower === "src" && value) {
      //           if (youtubeRegex.test(String(value).toLowerCase())) {
      //             node.setAttribute("sandbox", "allow-scripts allow-same-origin");
      //           }
      //         }

      //         if (nameLower === "referrerpolicy") {
      //           // do not overwrite our policy
      //           return node;
      //         }
      //         if (nameLower === "sandbox") {
      //           // do not overwrite our policy
      //           return node;
      //         }
      //       }

      //       if (node.tagName === "BASE") {
      //         if (requireSecureProtocol) {
      //           if (
      //             nameLower === "href" &&
      //             value &&
      //             String(value).indexOf("http:") === 0
      //           ) {
      //             value = convertUrlToSecureProtocolIfNeeded(value);
      //             node.setAttribute(name, value);
      //             return node;
      //           }
      //         }
      //       }
      //     },
      //   });

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
