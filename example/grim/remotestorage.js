/** remotestorage.js 0.8.2 remotestorage.io, MIT-licensed **/

/** FILE: lib/promising.js **/
(function(global) {
  function getPromise(builder) {
    var promise;

    if(typeof(builder) === 'function') {
      setTimeout(function() {
        try {
          builder(promise);
        } catch(e) {
          promise.reject(e);
        }
      }, 0);
    }

    var consumers = [], success, result;

    function notifyConsumer(consumer) {
      if(success) {
        var nextValue;
        if(consumer.fulfilled) {
          try {
            nextValue = [consumer.fulfilled.apply(null, result)];
          } catch(exc) {
            consumer.promise.reject(exc);
            return;
          }
        } else {
          nextValue = result;
        }
        if(nextValue[0] && typeof(nextValue[0].then) === 'function') {
          nextValue[0].then(consumer.promise.fulfill, consumer.promise.reject);
        } else {
          consumer.promise.fulfill.apply(null, nextValue);
        }
      } else {
        if(consumer.rejected) {
          var ret;
          try {
            ret = consumer.rejected.apply(null, result);
          } catch(exc) {
            consumer.promise.reject(exc);
            return;
          }
          if(ret && typeof(ret.then) === 'function') {
            ret.then(consumer.promise.fulfill, consumer.promise.reject);
          } else {
            consumer.promise.fulfill(ret);
          }
        } else {
          consumer.promise.reject.apply(null, result);
        }
      }
    }

    function resolve(succ, res) {
      if(result) {
        console.error("WARNING: Can't resolve promise, already resolved!");
        return;
      }
      success = succ;
      result = Array.prototype.slice.call(res);
      setTimeout(function() {
        var cl = consumers.length;
        if(cl === 0 && (! success)) {
          console.error("Possibly uncaught error: ", result, result[0] && result[0].stack);
        }
        for(var i=0;i<cl;i++) {
          notifyConsumer(consumers[i]);
        }
        consumers = undefined;
      }, 0);
    }

    promise = {

      then: function(fulfilled, rejected) {
        var consumer = {
          fulfilled: typeof(fulfilled) === 'function' ? fulfilled : undefined,
          rejected: typeof(rejected) === 'function' ? rejected : undefined,
          promise: getPromise()
        };
        if(result) {
          setTimeout(function() {
            notifyConsumer(consumer)
          }, 0);
        } else {
          consumers.push(consumer);
        }
        return consumer.promise;
      },

      fulfill: function() {
        resolve(true, arguments);
        return this;
      },
      
      reject: function() {
        resolve(false, arguments);
        return this;
      }
      
    };

    return promise;
  };

  global.promising = getPromise;

})(typeof(window) != 'undefined' ? window : global);


/** FILE: lib/local.js **/
if (typeof this.local == 'undefined')
	this.local = {};

(function() {

	function isPromiselike(p) {
		return (p && typeof p.then == 'function');
	}

	// Promise
	// =======
	// EXPORTED
	// Monadic function chaining around asynchronously-fulfilled values
	// - conformant with the promises/a+ spec
	// - better to use the `promise` function to construct
	function Promise(value) {
		this.succeedCBs = []; // used to notify about fulfillments
		this.failCBs = []; // used to notify about rejections
		this.__hasValue = false;
		this.__hasFailed = false;
		this.value = undefined;
		if (value)
			this.fulfill(value);
	}
	Promise.prototype.isUnfulfilled = function() { return !this.__hasValue; };
	Promise.prototype.isRejected = function() { return this.__hasFailed; };
	Promise.prototype.isFulfilled = function() { return (this.__hasValue && !this.__hasFailed); };

	// helper function to execute `then` behavior
	function execCallback(parentPromise, targetPromise, fn) {
		if (fn === null) {
			if (parentPromise.isRejected())
				targetPromise.reject(parentPromise.value);
			else
				targetPromise.fulfill(parentPromise.value);
		} else {
			var newValue;
			try { newValue = fn(parentPromise.value); }
			catch (e) {
				if (local.logAllExceptions || e instanceof Error) {
					if (console.error)
						console.error(e, e.stack);
					else console.log("Promise exception thrown", e, e.stack);
				}
				targetPromise.reject(e);
			}

			if (isPromiselike(newValue))
				promise(newValue).chain(targetPromise);
			else
				targetPromise.fulfill(newValue);
		}
	}

	// add a 'succeed' and an 'fail' function to the sequence
	Promise.prototype.then = function(succeedFn, failFn) {
		succeedFn = (succeedFn && typeof succeedFn == 'function') ? succeedFn : null;
		failFn    = (failFn    && typeof failFn == 'function')    ? failFn    : null;

		var p = promise();
		if (this.isUnfulfilled()) {
			this.succeedCBs.push({ p:p, fn:succeedFn });
			this.failCBs.push({ p:p, fn:failFn });
		} else {
			var self = this;
			setTimeout(function() {
				if (self.isFulfilled())
					execCallback(self, p, succeedFn);
				else
					execCallback(self, p, failFn);
			}, 0);
		}
		return p;
	};

	// add a non-error function to the sequence
	// - will be skipped if in 'error' mode
	Promise.prototype.succeed = function(fn) {
		if (this.isRejected()) {
			return this;
		} else {
			var args = Array.prototype.slice.call(arguments, 1);
			return this.then(function(v) {
				return fn.apply(null, [v].concat(args));
			});
		}
	};

	// add an error function to the sequence
	// - will be skipped if in 'non-error' mode
	Promise.prototype.fail = function(fn) {
		if (this.isFulfilled()) {
			return this;
		} else {
			var args = Array.prototype.slice.call(arguments, 1);
			return this.then(null, function(v) {
				return fn.apply(null, [v].concat(args));
			});
		}
	};

	// add a function to the success and error paths of the sequence
	Promise.prototype.always = function(fn) {
		return this.then(fn, fn);
	};

	// sets the promise value, enters 'succeed' mode, and executes any queued `then` functions
	Promise.prototype.fulfill = function(value) {
		if (this.isUnfulfilled()) {
			this.value = value;
			this.__hasValue = true;
			for (var i=0; i < this.succeedCBs.length; i++) {
				var cb = this.succeedCBs[i];
				execCallback(this, cb.p, cb.fn);
			}
			this.succeedCBs.length = 0;
			this.failCBs.length = 0;
		}
		return this;
	};

	// sets the promise value, enters 'error' mode, and executes any queued `then` functions
	Promise.prototype.reject = function(err) {
		if (this.isUnfulfilled()) {
			this.value = err;
			this.__hasValue = true;
			this.__hasFailed = true;
			for (var i=0; i < this.failCBs.length; i++) {
				var cb = this.failCBs[i];
				execCallback(this, cb.p, cb.fn);
			}
			this.succeedCBs.length = 0;
			this.failCBs.length = 0;
		}
		return this;
	};

	// releases all of the remaining references in the prototype chain
	// - to be used in situations where promise handling will not continue, and memory needs to be freed
	Promise.prototype.cancel = function() {
		// propagate the command to promises later in the chain
		var i;
		for (i=0; i < this.succeedCBs.length; i++) {
			this.succeedCBs[i].p.cancel();
		}
		for (i=0; i < this.failCBs.length; i++) {
			this.failCBs[i].p.cancel();
		}
		// free up memory
		this.succeedCBs.length = 0;
		this.failCBs.length = 0;
		return this;
	};

	// sets up the given promise to fulfill/reject upon the method-owner's fulfill/reject
	Promise.prototype.chain = function(otherPromise) {
		this.then(
			function(v) {
				promise(otherPromise).fulfill(v);
				return v;
			},
			function(err) {
				promise(otherPromise).reject(err);
				return err;
			}
		);
		return otherPromise;
	};

	// provides a node-style function for fulfilling/rejecting based on the (err, result) pattern
	Promise.prototype.cb = function(err, value) {
		if (err)
			this.reject(err);
		else
			this.fulfill((typeof value == 'undefined') ? null : value);
	};

	// bundles an array of promises into a single promise that requires none to succeed for a pass
	// - `shouldFulfillCB` is called with (results, fails) to determine whether to fulfill or reject
	function bundle(ps, shouldFulfillCB) {
		if (!Array.isArray(ps)) ps = [ps];
		var p = promise(), nPromises = ps.length, nFinished = 0;
		if (nPromises === 0) {
			p.fulfill([]);
			return p;
		}

		var results = []; results.length = nPromises;
		var fails = [];
		var addResult = function(v, index, isfail) {
			results[index] = v;
			if (isfail) fails.push(index);
			if ((++nFinished) == nPromises) {
				if (!shouldFulfillCB) p.fulfill(results);
				else if (shouldFulfillCB(results, fails)) p.fulfill(results);
				else p.reject(results);
			}
		};
		for (var i=0; i < nPromises; i++)
			promise(ps[i]).succeed(addResult, i, false).fail(addResult, i, true);
		return p;
	}

	// bundles an array of promises into a single promise that requires all to succeed for a pass
	function all(ps) {
		return bundle(ps, function(results, fails) {
			return fails.length === 0;
		});
	}

	// bundles an array of promises into a single promise that requires one to succeed for a pass
	function any(ps) {
		return bundle(ps, function(results, fails) {
			return fails.length < results.length;
		});
	}

	// promise creator
	// - behaves like a guard, ensuring `v` is a promise
	// - if multiple arguments are given, will provide a promise that encompasses all of them
	//   - containing promise always succeeds
	function promise(v) {
		if (arguments.length > 1)
			return bundle(Array.prototype.slice.call(arguments));
		if (v instanceof Promise)
			return v;
		if (isPromiselike(v)) {
			var p = promise();
			v.then(function(v2) { p.fulfill(v2); }, function(v2) { p.reject(v2); });
			return p;
		}
		return new Promise(v);
	}

	local.Promise = Promise;
	local.promise = promise;
	local.promise.bundle = bundle;
	local.promise.all = all;
	local.promise.any = any;
})();// Local Utilities
// ===============
// pfraze 2013

if (typeof this.local == 'undefined')
	this.local = {};
if (typeof this.local.util == 'undefined')
	this.local.util = {};

(function() {// EventEmitter
// ============
// EXPORTED
// A minimal event emitter, based on the NodeJS api
// initial code borrowed from https://github.com/tmpvar/node-eventemitter (thanks tmpvar)
function EventEmitter() {
	Object.defineProperty(this, '_events', {
		value: {},
		configurable: false,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, '_suspensions', {
		value: 0,
		configurable: false,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, '_history', {
		value: [],
		configurable: false,
		enumerable: false,
		writable: true
	});
}

EventEmitter.prototype.suspendEvents = function() {
	this._suspensions++;
};

EventEmitter.prototype.resumeEvents = function() {
	this._suspensions--;
	if (this._suspensions <= 0)
		this.playbackHistory();
};

EventEmitter.prototype.isSuspended = function() { return this._suspensions > 0; };

EventEmitter.prototype.playbackHistory = function() {
	var e;
	// always check if we're suspended - a handler might resuspend us
	while (!this.isSuspended() && (e = this._history.shift()))
		this.emit.apply(this, e);
};

EventEmitter.prototype.emit = function(type) {
	var args = Array.prototype.slice.call(arguments);

	if (this.isSuspended()) {
		this._history.push(args);
		return;
	}

	var handlers = this._events[type];
	if (!handlers) return false;

	args = args.slice(1);
	for (var i = 0, l = handlers.length; i < l; i++)
		handlers[i].apply(this, args);

	return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
	if (Array.isArray(type)) {
		type.forEach(function(t) { this.addListener(t, listener); }, this);
		return;
	}

	if ('function' !== typeof listener) {
		throw new Error('addListener only takes instances of Function');
	}

	// To avoid recursion in the case that type == "newListeners"! Before
	// adding it to the listeners, first emit "newListeners".
	this.emit('newListener', type, listener);

	if (!this._events[type]) {
		this._events[type] = [listener];
	} else {
		this._events[type].push(listener);
	}

	return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
	var self = this;
	self.on(type, function g() {
		self.removeListener(type, g);
		listener.apply(this, arguments);
	});

	return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
	if ('function' !== typeof listener) {
		throw new Error('removeListener only takes instances of Function');
	}
	if (!this._events[type]) return this;

	var list = this._events[type];
	var i = list.indexOf(listener);
	if (i < 0) return this;
	list.splice(i, 1);
	if (list.length === 0) {
		delete this._events[type];
	}

	return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
	if (type) this._events[type] = null;
	else this._events = {};
	if (this._history[type]) this._history[type] = null;
	return this;
};

EventEmitter.prototype.listeners = function(type) {
	return this._events[type];
};

local.util.EventEmitter = EventEmitter;

// Adds event-emitter behaviors to the given object
// - should be used on instantiated objects, not prototypes
local.util.mixinEventEmitter = function(obj) {
	EventEmitter.call(obj);
	for (var k in EventEmitter.prototype) {
		obj[k] = EventEmitter.prototype[k];
	}
};// Helpers
// =======

if (typeof CustomEvent === 'undefined') {
	// CustomEvent shim (safari)
	// thanks to netoneko https://github.com/maker/ratchet/issues/101
	CustomEvent = function(type, eventInitDict) {
		var event = document.createEvent('CustomEvent');

		event.initCustomEvent(type, eventInitDict['bubbles'], eventInitDict['cancelable'], eventInitDict['detail']);
		return event;
	};
}

// Track window close event
local.util.isAppClosing = false;
if (typeof window != 'undefined') {
	window.addEventListener('beforeunload', function() {
		local.util.isAppClosing = true;
	});
}

// EXPORTED
// searches up the node tree for an element
function findParentNode(node, test) {
	while (node) {
		if (test(node)) { return node; }
		node = node.parentNode;
	}
	return null;
}

findParentNode.byTag = function(node, tagName) {
	return findParentNode(node, function(elem) {
		return elem.tagName == tagName;
	});
};

findParentNode.byClass = function(node, className) {
	return findParentNode(node, function(elem) {
		return elem.classList && elem.classList.contains(className);
	});
};

findParentNode.byElement = function(node, element) {
	return findParentNode(node, function(elem) {
		return elem === element;
	});
};

findParentNode.thatisFormRelated = function(node) {
	return findParentNode(node, function(elem) {
		return !!elem.form;
	});
};

// combines parameters as objects
// - precedence is rightmost
//     reduceObjects({a:1}, {a:2}, {a:3}) => {a:3}
function reduceObjects() {
	var objs = Array.prototype.slice.call(arguments);
	var acc = {}, obj;
	while (objs.length) {
		obj = objs.shift();
		if (!obj) { continue; }
		for (var k in obj) {
			if (typeof obj[k] == 'undefined' || obj[k] === null) { continue; }
			if (typeof obj[k] == 'object' && !Array.isArray(obj[k])) {
				acc[k] = reduceObjects(acc[k], obj[k]);
			} else {
				acc[k] = obj[k];
			}
		}
	}
	return acc;
}

// EXPORTED
// dispatches a request event, stopping the given event
function dispatchRequestEvent(targetElem, request) {
	var re = new CustomEvent('request', { bubbles:true, cancelable:true, detail:request });
	targetElem.dispatchEvent(re);
}

// EXPORTED
// submit helper, makes it possible to find the button which triggered the submit
function trackFormSubmitter(node) {
	var elem = findParentNode.thatisFormRelated(node);
	if (elem) {
		for (var i=0; i < elem.form.length; i++) {
			elem.form[i].setAttribute('submitter', null);
		}
		elem.setAttribute('submitter', '1');
	}
}

// EXPORTED
// extracts request from any given element
function extractRequest(targetElem, containerElem) {
	var requests = { form:{}, fieldset:{}, elem:{} };
	var fieldset = null, form = null;

	// find parent fieldset
	if (targetElem.tagName === 'FIELDSET') {
		fieldset = targetElem;
	} else if (targetElem.tagName !== 'FORM') {
		fieldset = findParentNode.byTag(targetElem, 'FIELDSET');
	}

	// find parent form
	if (targetElem.tagName === 'FORM') {
		form = targetElem;
	} else {
		// :TODO: targetElem.form may be a simpler alternative
		var formId = targetElem.getAttribute('form') || (fieldset ? fieldset.getAttribute('form') : null);
		if (formId) {
			form = containerElem.querySelector('#'+formId);
		}
		if (!form) {
			form = findParentNode.byTag(targetElem, 'FORM');
		}
	}

	// extract payload
	var payload = extractRequestPayload(targetElem, form);

	// extract form headers
	if (form) {
		requests.form = extractRequest.fromForm(form, targetElem);
	}

	// extract fieldset headers
	if (fieldset) {
		requests.fieldset = extractRequest.fromFormElement(fieldset);
	}

	// extract element headers
	if (targetElem.tagName === 'A') {
		requests.elem = extractRequest.fromAnchor(targetElem);
	} else if (['FORM','FIELDSET'].indexOf(targetElem.tagName) === -1) {
		requests.elem = extractRequest.fromFormElement(targetElem);
	}

	// combine then all, with precedence given to rightmost objects in param list
	var req = reduceObjects(requests.form, requests.fieldset, requests.elem);
	var payloadWrapper = {};
	payloadWrapper[/GET/i.test(req.method) ? 'query' : 'body'] = payload;
	return reduceObjects(req, payloadWrapper);
}

// EXPORTED
// extracts request parameters from an anchor tag
extractRequest.fromAnchor = function(node) {

	// get the anchor
	node = findParentNode.byTag(node, 'A');
	if (!node || !node.attributes.href || node.attributes.href.value.charAt(0) == '#') { return null; }

	// pull out params
	var request = {
		// method  : 'get',
		url     : node.attributes.href.value,
		target  : node.getAttribute('target'),
		headers : { accept:node.getAttribute('type') }
	};
	return request;
};

// EXPORTED
// extracts request parameters from a form element (inputs, textareas, etc)
extractRequest.fromFormElement = function(node) {
	// :TODO: search parent for the form-related element?
	//        might obviate the need for submitter-tracking

	// pull out params
	var request = {
		method  : node.getAttribute('formmethod'),
		url     : node.getAttribute('formaction'),
		target  : node.getAttribute('formtarget'),
		headers : {
			'content-type' : node.getAttribute('formenctype'),
			accept         : node.getAttribute('formaccept')
		}
	};
	return request;
};

// EXPORTED
// extracts request parameters from a form
extractRequest.fromForm = function(form, submittingElem) {

	// find the submitter, if the submitting element is not form-related
	if (submittingElem && !submittingElem.form) {
		for (var i=0; i < form.length; i++) {
			var elem = form[i];
			if (elem.getAttribute('submitter') == '1') {
				submittingElem = elem;
				elem.setAttribute('submitter', '0');
				break;
			}
		}
	}

	var requests = { submitter:{}, form:{} };
	// extract submitting element headers
	if (submittingElem) {
		requests.submitter = {
			method  : submittingElem.getAttribute('formmethod'),
			url     : submittingElem.getAttribute('formaction'),
			target  : submittingElem.getAttribute('formtarget'),
			headers : {
				'content-type' : submittingElem.getAttribute('formenctype'),
				accept         : submittingElem.getAttribute('formaccept')
			}
		};
	}
	// extract form headers
	requests.form = {
		method  : form.getAttribute('method'),
		url     : form.getAttribute('action'),
		target  : form.getAttribute('target'),
		headers : {
			'content-type' : form.getAttribute('enctype') || form.enctype,
			'accept'       : form.getAttribute('accept')
		}
	};
	if (form.acceptCharset) { requests.form.headers.accept = form.acceptCharset; }

	// combine, with precedence to the submitting element
	var request = reduceObjects(requests.form, requests.submitter);

	// strip the base URI
	// :TODO: needed?
	/*var base_uri = window.location.href.split('#')[0];
	if (target_uri.indexOf(base_uri) != -1) {
		target_uri = target_uri.substring(base_uri.length);
		if (target_uri.charAt(0) != '/') { target_uri = '/' + target_uri; }
	}*/

	return request;
};

// EXPORTED
// serializes all form elements beneath and including the given element
// - `targetElem`: container element, will reject the field if not within (optional)
// - `form`: an array of HTMLElements or a form field (they behave the same for iteration)
// - `opts.nofiles`: dont try to read files in file fields? (optional)
function extractRequestPayload(targetElem, form, opts) {
	if (!opts) opts = {};

	// iterate form elements
	var data = {};
	if (!opts.nofiles)
		data.__fileReads = []; // an array of promises to read <input type=file>s
	for (var i=0; i < form.length; i++) {
		var elem = form[i];

		// skip if it doesnt have a name
		if (!elem.name) {
			continue;
		}

		// skip if not a child of the target element
		if (targetElem && !findParentNode.byElement(elem, targetElem))
			continue;

		// pull value if it has one
		var isSubmittingElem = elem.getAttribute('submitter') == '1';
		if (elem.tagName === 'BUTTON') {
			if (isSubmittingElem) {
				// don't pull from buttons unless recently clicked
				data[elem.name] = elem.value;
			}
		} else if (elem.tagName === 'INPUT') {
			switch (elem.type.toLowerCase()) {
				case 'button':
				case 'submit':
					if (isSubmittingElem) {
						// don't pull from buttons unless recently clicked
						data[elem.name] = elem.value;
					}
					break;
				case 'checkbox':
					if (elem.checked) {
						// don't pull from checkboxes unless checked
						data[elem.name] = (data[elem.name] || []).concat(elem.value);
					}
					break;
				case 'radio':
					if (elem.getAttribute('checked') !== null) {
						// don't pull from radios unless selected
						data[elem.name] = elem.value;
					}
					break;
				case 'file':
					// read the files
					if (opts.nofiles)
						break;
					if (elem.multiple) {
						for (var i=0, f; f = elem.files[i]; i++)
							readFile(data, elem, elem.files[i], i);
						data[elem.name] = [];
						data[elem.name].length = i;
					} else {
						readFile(data, elem, elem.files[0]);
					}
					break;
				default:
					data[elem.name] = elem.value;
					break;
			}
		} else
			data[elem.name] = elem.value;
	}

	return data;
}

// INTERNAL
// file read helpers
function readFile(data, elem, file, index) {
	if (!file) return; // no value set
	var reader = new FileReader();
	reader.onloadend = readFileLoadEnd(data, elem, file, index);
	reader.readAsDataURL(file);
}
function readFileLoadEnd(data, elem, file, index) {
	// ^ this avoids a closure circular reference
	var promise = local.promise();
	data.__fileReads.push(promise);
	return function(e) {
		var obj = {
			content: e.target.result || null,
			name: file.name,
			formattr: elem.name,
			size: file.size,
			type: file.type,
			lastModifiedDate: file.lastModifiedDate
		};
		if (typeof index != 'undefined')
			obj.formindex = index;
		promise.fulfill(obj);
	};
}
function finishPayloadFileReads(request) {
	var fileReads = (request.body) ? request.body.__fileReads :
					((request.query) ? request.query.__fileReads : []);
	return local.promise.bundle(fileReads).then(function(files) {
		if (request.body) delete request.body.__fileReads;
		if (request.query) delete request.query.__fileReads;
		files.forEach(function(file) {
			if (typeof file.formindex != 'undefined')
				request.body[file.formattr][file.formindex] = file;
			else request.body[file.formattr] = file;
		});
		return request;
	});
}

local.util.findParentNode = findParentNode;
local.util.trackFormSubmitter = trackFormSubmitter;
local.util.dispatchRequestEvent = dispatchRequestEvent;
local.util.extractRequest = extractRequest;
local.util.extractRequestPayload = extractRequestPayload;
local.util.finishPayloadFileReads = finishPayloadFileReads;// http://jsperf.com/cloning-an-object/2
local.util.deepClone = function(obj) {
	return JSON.parse(JSON.stringify(obj));
};})();// Local HTTP
// ==========
// pfraze 2013

if (typeof this.local == 'undefined')
	this.local = {};

(function() {
// Local status codes
// ==================
// used to specify client operation states

// link query failed to match
local.LINK_NOT_FOUND = 1;// Helpers
// =======

// EXPORTED
// takes parsed a link header and a query object, produces an array of matching links
// - `links`: [object]/object, either the parsed array of links or the request/response object
// - `query`: object
local.queryLinks = function queryLinks(links, query) {
	if (!links) return [];
	if (links.parsedHeaders) links = links.parsedHeaders.link; // actually a request or response object
	if (!Array.isArray(links)) return [];
	return links.filter(function(link) { return local.queryLink(link, query); });
};

// EXPORTED
// takes parsed link and a query object, produces boolean `isMatch`
// - `query`: object, keys are attributes to test, values are values to test against (strings)
//            eg { rel: 'foo bar', id: 'x' }
// - Query rules
//   - if a query attribute is present on the link, but does not match, returns false
//   - if a query attribute is not present on the link, and is not present in the href as a URI Template token, returns false
//   - otherwise, returns true
//   - query values preceded by an exclamation-point (!) will invert (logical NOT)
//   - rel: can take multiple values, space-separated, which are ANDed logically
//   - rel: will ignore the preceding scheme and trailing slash on URI values
//   - rel: items preceded by an exclamation-point (!) will invert (logical NOT)
local.queryLink = function queryLink(link, query) {
	for (var attr in query) {
		if (attr == 'rel') {
			var terms = query.rel.split(/\s+/);
			for (var i=0; i < terms.length; i++) {
				var desiredBool = true;
				if (terms[i].charAt(0) == '!') {
					terms[i] = terms[i].slice(1);
					desiredBool = false;
				}
				if (RegExp('(\\s|^)(.*//)?'+terms[i]+'(\\s|$)', 'i').test(link.rel) !== desiredBool)
					return false;
			}
		}
		else {
			if (typeof link[attr] == 'undefined') {
				// Attribute not explicitly set -- is it present in the href as a URI token?
				if (RegExp('\\{[^\\}]*'+attr+'[^\\{]*\\}','i').test(link.href) === false)
					return false;
			}
			else {
				if (query[attr].indexOf('!') === 0) { // negation
					if (link[attr] == query[attr].slice(1))
						return false;
				} else {
					if (link[attr] != query[attr])
						return false;
				}
			}
		}
	}
	return true;
};

// <https://github.com/federomero/negotiator>
// thanks to ^ for the content negotation helpers below
// INTERNAL
function getMediaTypePriority(type, accepted) {
	var matches = accepted
		.filter(function(a) { return specify(type, a); })
		.sort(function (a, b) { return a.q > b.q ? -1 : 1; }); // revsort
	return matches[0] ? matches[0].q : 0;
}
// INTERNAL
function specifies(spec, type) {
	return spec === '*' || spec === type;
}
// INTERNAL
function specify(type, spec) {
	var p = parseMediaType(type);

	if (spec.params) {
		var keys = Object.keys(spec.params);
		if (keys.some(function (k) { return !specifies(spec.params[k], p.params[k]); })) {
			// some didn't specify.
			return null;
		}
	}

	if (specifies(spec.type, p.type) && specifies(spec.subtype, p.subtype)) {
		return spec;
	}
}

// EXPORTED
// returns an array of preferred media types ordered by priority from a list of available media types
// - `accept`: string/object, given accept header or request object
// - `provided`: optional [string], allowed media types
local.preferredTypes = function preferredTypes(accept, provided) {
	if (typeof accept == 'object') {
		accept = accept.headers.accept;
	}
	accept = local.httpHeaders.deserialize('accept', accept || '');
	if (provided) {
		if (!Array.isArray(provided)) {
			provided = [provided];
		}
		return provided
			.map(function(type) { return [type, getMediaTypePriority(type, accept)]; })
			.filter(function(pair) { return pair[1] > 0; })
			.sort(function(a, b) { return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1; }) // revsort
			.map(function(pair) { return pair[0]; });
	}
	return accept.map(function(type) { return type.full; });
};

// EXPORTED
// returns the top preferred media type from a list of available media types
// - `accept`: string/object, given accept header or request object
// - `provided`: optional [string], allowed media types
local.preferredType = function preferredType(accept, provided) {
	return local.preferredTypes(accept, provided)[0];
};
// </https://github.com/federomero/negotiator>

// EXPORTED
// correctly joins together all url segments given in the arguments
// eg joinUri('/foo/', '/bar', '/baz/') -> '/foo/bar/baz/'
local.joinUri = function joinUri() {
	var parts = Array.prototype.map.call(arguments, function(arg, i) {
		arg = ''+arg;
		var lo = 0, hi = arg.length;
		if (arg == '/') return '';
		if (i !== 0 && arg.charAt(0) === '/') { lo += 1; }
		if (arg.charAt(hi - 1) === '/') { hi -= 1; }
		return arg.substring(lo, hi);
	});
	return parts.join('/');
};

// EXPORTED
// tests to see if a URL is absolute
// - "absolute" means that the URL can reach something without additional context
// - eg http://foo.com, //foo.com, httpl://bar.app
var isAbsUriRE = /^((http(s|l)?:)?\/\/)|((nav:)?\|\|)/;
local.isAbsUri = function(url) {
	if (isAbsUriRE.test(url))
		return true;
	var urld = local.parseUri(url);
	return !!local.getServer(urld.authority) || !!local.parsePeerDomain(urld.authority);
};

// EXPORTED
// tests to see if a URL is using the nav scheme
var isNavSchemeUriRE = /^(nav:)?\|?\|/i;
local.isNavSchemeUri = function(v) {
	return isNavSchemeUriRE.test(v);
};


// EXPORTED
// takes a context url and a relative path and forms a new valid url
// eg joinRelPath('http://grimwire.com/foo/bar', '../fuz/bar') -> 'http://grimwire.com/foo/fuz/bar'
local.joinRelPath = function(urld, relpath) {
	if (typeof urld == 'string') {
		urld = local.parseUri(urld);
	}
	var protocol = (urld.protocol) ? urld.protocol + '://' : false;
	if (!protocol) {
		if (urld.source.indexOf('//') === 0) {
			protocol = '//';
		} else if (urld.source.indexOf('||') === 0) {
			protocol = '||';
		} else {
			protocol = 'httpl://';
		}
	}
	if (relpath.charAt(0) == '/') {
		// "absolute" relative, easy stuff
		return protocol + urld.authority + relpath;
	}
	// totally relative, oh god
	// (thanks to geoff parker for this)
	var hostpath = urld.path;
	var hostpathParts = hostpath.split('/');
	var relpathParts = relpath.split('/');
	for (var i=0, ii=relpathParts.length; i < ii; i++) {
		if (relpathParts[i] == '.')
			continue; // noop
		if (relpathParts[i] == '..')
			hostpathParts.pop();
		else
			hostpathParts.push(relpathParts[i]);
	}
	return local.joinUri(protocol + urld.authority, hostpathParts.join('/'));
};

// EXPORTED
// parseUri 1.2.2, (c) Steven Levithan <stevenlevithan.com>, MIT License
local.parseUri = function parseUri(str) {
	if (typeof str === 'object') {
		if (str.url) { str = str.url; }
		else if (str.host || str.path) { str = local.joinUri(req.host, req.path); }
	}

	// handle data-uris specially - performance characteristics are much different
	if (str.slice(0,5) == 'data:') {
		return { protocol: 'data', source: str };
	}

	var	o   = local.parseUri.options,
		m   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
		uri = {},
		i   = 14;

	while (i--) uri[o.key[i]] = m[i] || "";

	uri[o.q.name] = {};
	uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
		if ($1) uri[o.q.name][$1] = $2;
	});

	return uri;
};

local.parseUri.options = {
	strictMode: false,
	key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
	q:   {
		name:   "queryKey",
		parser: /(?:^|&)([^&=]*)=?([^&]*)/g
	},
	parser: {
		strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
		loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
	}
};

// EXPORTED
// Converts a 'nav:' URI into an array of http/s/l URIs and link query objects
local.parseNavUri = function(str) {
	if (!str) return [];

	// Check (and strip out) scheme
	var schemeIndex = str.indexOf('||');
	if (schemeIndex !== -1) {
		str = str.slice(schemeIndex+2);
	}

	// Split into navigations
	var parts = str.split('|');

	// Parse queries
	// eg ...|rel=id,attr1=value1,attr2=value2|...
	for (var i=1; i < parts.length; i++) {
		var query = {};
		var attrs = parts[i].split(',');
		for (var j=0; j < attrs.length; j++) {
			var kv = attrs[j].split('=');
			if (j === 0) {
				query.rel = kv[0].replace(/\+/g, ' ');
				if (kv[1])
					query.id = kv[1];
			} else
				query[kv[0]] = decodeURIComponent(kv[1]).replace(/\+/g, ' ');
		}
		parts[i] = query;
	}

	// Drop first entry if empty (a relative nav uri)
	if (!parts[0])
		parts.shift();

	return parts;
};

// EXPORTED
// breaks a peer domain into its constituent parts
// - returns { user:, relay:, provider:, app:, stream: }
//   (relay == provider -- they are synonmyms)
var peerDomainRE = /^(.+)@([^!]+)!([^:\/]+)(?::([\d]+))?$/i;
local.parsePeerDomain = function parsePeerDomain(domain) {
	var match = peerDomainRE.exec(domain);
	if (match) {
		return {
			domain: domain,
			user: match[1],
			relay: match[2],
			provider: match[2],
			app: match[3],
			stream: match[4] || 0
		};
	}
	return null;
};

// EXPORTED
// constructs a peer domain from its constituent parts
// - returns string
local.makePeerDomain = function makePeerDomain(user, relay, app, stream) {
	return user+'@'+relay.replace(':','.')+'!'+app.replace(':','.')+((stream) ? ':'+stream : '');
};


// sends the given response back verbatim
// - if `writeHead` has been previously called, it will not change
// - params:
//   - `target`: the response to populate
//   - `source`: the response to pull data from
//   - `headersCb`: (optional) takes `(headers)` from source and responds updated headers for target
//   - `bodyCb`: (optional) takes `(body)` from source and responds updated body for target
local.pipe = function(target, source, headersCB, bodyCb) {
	headersCB = headersCB || function(v) { return v; };
	bodyCb = bodyCb || function(v) { return v; };
	return local.promise(source)
		.succeed(function(source) {
			if (!target.status) {
				// copy the header if we don't have one yet
				target.writeHead(source.status, source.reason, headersCB(source.headers));
			}
			if (source.body !== null && typeof source.body != 'undefined') { // already have the body?
				target.write(bodyCb(source.body));
			}
			if (source.on && source.isConnOpen) {
				// wire up the stream
				source.on('data', function(data) {
					target.write(bodyCb(data));
				});
				source.on('end', function() {
					target.end();
				});
			} else {
				target.end();
			}
			return target;
		})
		.fail(function(source) {
			var ctype = source.headers['content-type'] || 'text/plain';
			var body = (ctype && source.body) ? source.body : '';
			target.writeHead(502, 'bad gateway', {'content-type':ctype});
			target.end(body);
			throw source;
		});
};// contentTypes
// ============
// EXPORTED
// provides serializers and deserializers for MIME types
var contentTypes = {
	serialize   : contentTypes__serialize,
	deserialize : contentTypes__deserialize,
	register    : contentTypes__register
};
var contentTypes__registry = {};
local.contentTypes = contentTypes;

// EXPORTED
// serializes an object into a string
function contentTypes__serialize(type, obj) {
	if (!obj || typeof(obj) != 'object' || !type) {
		return obj;
	}
	var fn = contentTypes__find(type, 'serializer');
	if (!fn) {
		return obj;
	}
	return fn(obj);
}

// EXPORTED
// deserializes a string into an object
function contentTypes__deserialize(type, str) {
	if (!str || typeof(str) != 'string' || !type) {
		return str;
	}
	var fn = contentTypes__find(type, 'deserializer');
	if (!fn) {
		return str;
	}
	try {
		return fn(str);
	} catch (e) {
		console.warn('Failed to deserialize content', type, str);
		return str;
	}
}

// EXPORTED
// adds a type to the registry
function contentTypes__register(type, serializer, deserializer) {
	contentTypes__registry[type] = {
		serializer   : serializer,
		deserializer : deserializer
	};
}

// INTERNAL
// takes a mimetype (text/asdf+html), puts out the applicable types ([text/asdf+html, text/html, text])
function contentTypes__mkTypesList(type) {
	var parts = type.split(';');
	var t = parts[0];
	parts = t.split('/');
	if (parts[1]) {
		var parts2 = parts[1].split('+');
		if (parts2[1]) {
			return [t, parts[0] + '/' + parts2[1], parts[0]];
		}
		return [t, parts[0]];
	}
	return [t];
}

// INTERNAL
// finds the closest-matching type in the registry and gives the request function
function contentTypes__find(type, fn) {
	var types = contentTypes__mkTypesList(type);
	for (var i=0; i < types.length; i++) {
		if (types[i] in contentTypes__registry)
			return contentTypes__registry[types[i]][fn];
	}
	return null;
}

// Default Types
// =============
local.contentTypes.register('application/json',
	function (obj) {
		try {
			return JSON.stringify(obj);
		} catch (e) {
			return e.message;
		}
	},
	function (str) {
		try {
			return JSON.parse(str);
		} catch (e) {
			return e.message;
		}
	}
);
local.contentTypes.register('application/x-www-form-urlencoded',
	function (obj) {
		var enc = encodeURIComponent;
		var str = [];
		for (var k in obj) {
			if (obj[k] === null) {
				str.push(k+'=');
			} else if (Array.isArray(obj[k])) {
				for (var i=0; i < obj[k].length; i++) {
					str.push(k+'[]='+enc(obj[k][i]));
				}
			} else if (typeof obj[k] == 'object') {
				for (var k2 in obj[k]) {
					str.push(k+'['+k2+']='+enc(obj[k][k2]));
				}
			} else {
				str.push(k+'='+enc(obj[k]));
			}
		}
		return str.join('&');
	},
	function (params) {
		// thanks to Brian Donovan
		// http://stackoverflow.com/a/4672120
		var pairs = params.split('&'),
		result = {};

		for (var i = 0; i < pairs.length; i++) {
			var pair = pairs[i].split('='),
			key = decodeURIComponent(pair[0]),
			value = decodeURIComponent(pair[1]),
			isArray = /\[\]$/.test(key),
			dictMatch = key.match(/^(.+)\[([^\]]+)\]$/);

			if (dictMatch) {
				key = dictMatch[1];
				var subkey = dictMatch[2];

				result[key] = result[key] || {};
				result[key][subkey] = value;
			} else if (isArray) {
				key = key.substring(0, key.length-2);
				result[key] = result[key] || [];
				result[key].push(value);
			} else {
				result[key] = value;
			}
		}

		return result;
	}
);
local.contentTypes.register('text/event-stream',
	function (obj) {
		if (typeof obj.data != 'undefined')
			return "event: "+obj.event+"\r\ndata: "+JSON.stringify(obj.data)+"\r\n\r\n";
		return "event: "+obj.event+"\r\n\r\n";
	},
	function (str) {
		var m = {};
		str.split("\r\n").forEach(function(kv) {
			if (/^[\s]*$/.test(kv))
				return;
			kv = splitEventstreamKV(kv);
			if (!kv[0]) return; // comment lines have nothing before the colon
			m[kv[0]] = kv[1];
		});
		try { m.data = JSON.parse(m.data); }
		catch(e) {}
		return m;
	}
);
function splitEventstreamKV(kv) {
	var i = kv.indexOf(':');
	return [kv.slice(0, i).trim(), kv.slice(i+1).trim()];
}// headers
// =======
// EXPORTED
// provides serializers and deserializers for HTTP headers
var httpHeaders = {
	serialize   : httpheaders__serialize,
	deserialize : httpheaders__deserialize,
	register    : httpheaders__register
};
var httpheaders__registry = {};
local.httpHeaders = httpHeaders;

// EXPORTED
// serializes an object into a string
function httpheaders__serialize(header, obj) {
	if (!obj || typeof(obj) != 'object' || !header) {
		return obj;
	}
	var fn = httpheaders__find(header, 'serializer');
	if (!fn) {
		return obj;
	}
	return fn(obj);
}

// EXPORTED
// deserializes a string into an object
function httpheaders__deserialize(header, str) {
	if (!str || typeof(str) != 'string' || !header) {
		return str;
	}
	var fn = httpheaders__find(header, 'deserializer');
	if (!fn) {
		return str;
	}
	try {
		return fn(str);
	} catch (e) {
		console.warn('Failed to deserialize content', header, str);
		return str;
	}
}

// EXPORTED
// adds a header to the registry
function httpheaders__register(header, serializer, deserializer) {
	httpheaders__registry[header.toLowerCase()] = {
		serializer   : serializer,
		deserializer : deserializer
	};
}

// INTERNAL
// finds the header's de/serialization functions
function httpheaders__find(header, fn) {
	var headerFns = httpheaders__registry[header.toLowerCase()];
	if (headerFns) {
		return headerFns[fn];
	}
	return null;
}

// Default Headers
// ===============

var linkHeaderRE1 = /<(.*?)>(?:;[\s]*([^,]*))/g;
var linkHeaderRE2 = /([\-a-z0-9\.]+)=?(?:(?:"([^"]+)")|([^;\s]+))?/g;
local.httpHeaders.register('link',
	function (obj) {
		var links = [];
		obj.forEach(function(link) {
			var linkParts = ['<'+link.href+'>'];
			for (var attr in link) {
				if (attr == 'href') {
					continue;
				}
				if (link[attr] === null) {
					continue;
				}
				if (typeof link[attr] == 'boolean' && link[attr]) {
					linkParts.push(attr);
				} else {
					linkParts.push(attr+'="'+link[attr]+'"');
				}
			}
			links.push(linkParts.join('; '));
		});
		return links.join(', ');
	},
	function (str) {
		var links = [], linkParse1, linkParse2, link;
		// '</foo/bar>; rel="baz"; id="blah", </foo/bar>; rel="baz"; id="blah", </foo/bar>; rel="baz"; id="blah"'
		// Extract individual links
		while ((linkParse1 = linkHeaderRE1.exec(str))) { // Splits into href [1] and params [2]
			link = { href: linkParse1[1] };
			// 'rel="baz"; id="blah"'
			// Extract individual params
			while ((linkParse2 = linkHeaderRE2.exec(linkParse1[2]))) { // Splits into key [1] and value [2]/[3]
				link[linkParse2[1]] = linkParse2[2] || linkParse2[3] || true; // if no parameter value is given, just set to true
			}
			links.push(link);
		}
		return links;
	}
);

local.httpHeaders.register('accept',
	function (obj) {
		return obj.map(function(type) {
			var parts = [type.full];
			if (type.q !== 1) {
				parts.push('q='+type.q);
			}
			for (var k in type.params) {
				parts.push(k+'='+type.params[k]);
			}
			return parts.join('; ');
		}).join(', ');
	},
	function (str) {
		return str.split(',')
			.map(function(e) { return parseMediaType(e.trim()); })
			.filter(function(e) { return e && e.q > 0; });
	}
);
// thanks to https://github.com/federomero/negotiator
function parseMediaType(s) {
	var match = s.match(/\s*(\S+)\/([^;\s]+)\s*(?:;(.*))?/);
	if (!match) return null;

	var type = match[1];
	var subtype = match[2];
	var full = "" + type + "/" + subtype;
	var params = {}, q = 1;

	if (match[3]) {
		params = match[3].split(';')
			.map(function(s) { return s.trim().split('='); })
			.reduce(function (set, p) { set[p[0]] = p[1]; return set; }, params);

		if (params.q !== null) {
			q = parseFloat(params.q);
			delete params.q;
		}
	}

	return {
		type: type,
		subtype: subtype,
		params: params,
		q: q,
		full: full
	};
}// Request
// =======
// EXPORTED
// Interface for sending requests
function Request(options) {
	local.util.EventEmitter.call(this);

	if (!options) options = {};
	if (typeof options == 'string')
		options = { url: options };

	this.method = options.method ? options.method.toUpperCase() : 'GET';
	this.url = options.url || null;
	this.path = options.path || null;
	this.query = options.query || {};
	this.headers = options.headers || {};
	this.body = '';

	// Guess the content-type if a full body is included in the message
	if (options.body && !this.headers['content-type']) {
		this.headers['content-type'] = (typeof options.body == 'string') ? 'text/plain' : 'application/json';
	}
	// Make sure we have an accept header
	if (!this.headers['accept']) {
		this.headers['accept'] = '*/*';
	}

	// non-enumerables (dont include in request messages)
	Object.defineProperty(this, 'parsedHeaders', {
		value: {},
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'body', {
		value: '',
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'stream', {
		value: options.stream || false,
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'binary', {
		value: options.binary || false,
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'isConnOpen', {
		value: true,
		configurable: true,
		enumerable: false,
		writable: true
	});

	// request buffering
	Object.defineProperty(this, 'body_', {
		value: local.promise(),
		configurable: true,
		enumerable: false,
		writable: false
	});
	(function buffer(self) {
		self.on('data', function(data) { self.body += data; });
		self.on('end', function() {
			if (self.headers['content-type'])
				self.body = local.contentTypes.deserialize(self.headers['content-type'], self.body);
			self.body_.fulfill(self.body);
		});
	})(this);
}
local.Request = Request;
Request.prototype = Object.create(local.util.EventEmitter.prototype);

Request.prototype.setHeader    = function(k, v) { this.headers[k] = v; };
Request.prototype.getHeader    = function(k) { return this.headers[k]; };
Request.prototype.removeHeader = function(k) { delete this.headers[k]; };

// causes the request/response to abort after the given milliseconds
Request.prototype.setTimeout = function(ms) {
	var self = this;
	setTimeout(function() {
		if (self.isConnOpen) self.close();
	}, ms);
};

// EXPORTED
// calls any registered header serialization functions
// - enables apps to use objects during their operation, but remain conformant with specs during transfer
Request.prototype.serializeHeaders = function() {
	for (var k in this.headers) {
		this.headers[k] = local.httpHeaders.serialize(k, this.headers[k]);
	}
};

// EXPORTED
// calls any registered header deserialization functions
// - enables apps to use objects during their operation, but remain conformant with specs during transfer
Request.prototype.deserializeHeaders = function() {
	for (var k in this.headers) {
		var parsedHeader = local.httpHeaders.deserialize(k, this.headers[k]);
		if (parsedHeader && typeof parsedHeader != 'string') {
			this.parsedHeaders[k] = parsedHeader;
		}
	}
};

// sends data over the stream
// - emits the 'data' event
Request.prototype.write = function(data) {
	if (!this.isConnOpen)
		return this;
	if (typeof data != 'string')
		data = local.contentTypes.serialize(this.headers['content-type'], data);
	this.emit('data', data);
	return this;
};

// ends the request stream
// - `data`: optional mixed, to write before ending
// - emits 'end' and 'close' events
Request.prototype.end = function(data) {
	if (!this.isConnOpen)
		return this;
	if (typeof data != 'undefined')
		this.write(data);
	this.emit('end');
	// this.close();
	// ^ do not close - the response should close
	return this;
};

// closes the stream, aborting if not yet finished
// - emits 'close' event
Request.prototype.close = function() {
	if (!this.isConnOpen)
		return this;
	this.isConnOpen = false;
	this.emit('close');

	// :TODO: when events are suspended, this can cause problems
	//        maybe put these "removes" in a 'close' listener?
	// this.removeAllListeners('data');
	// this.removeAllListeners('end');
	// this.removeAllListeners('close');
	return this;
};// Response
// ========
// EXPORTED
// Interface for receiving responses
// - usually created internally and returned by `dispatch`
function Response() {
	local.util.EventEmitter.call(this);

	this.status = 0;
	this.reason = null;
	this.headers = {};
	this.body = '';

	// non-enumerables (dont include in response messages)
	Object.defineProperty(this, 'parsedHeaders', {
		value: {},
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'isConnOpen', {
		value: true,
		configurable: true,
		enumerable: false,
		writable: true
	});
	Object.defineProperty(this, 'latency', {
		value: undefined,
		configurable: true,
		enumerable: false,
		writable: true
	});

	// response buffering
	Object.defineProperty(this, 'body_', {
		value: local.promise(),
		configurable: true,
		enumerable: false,
		writable: false
	});
	(function buffer(self) {
		self.on('data', function(data) {
			if (data instanceof ArrayBuffer)
				self.body = data; // browsers buffer binary responses, so dont try to stream
			else
				self.body += data;
		});
		self.on('end', function() {
			if (self.headers['content-type'])
				self.body = local.contentTypes.deserialize(self.headers['content-type'], self.body);
			self.body_.fulfill(self.body);
		});
	})(this);
}
local.Response = Response;
Response.prototype = Object.create(local.util.EventEmitter.prototype);

Response.prototype.setHeader    = function(k, v) { this.headers[k] = v; };
Response.prototype.getHeader    = function(k) { return this.headers[k]; };
Response.prototype.removeHeader = function(k) { delete this.headers[k]; };

// EXPORTED
// calls any registered header serialization functions
// - enables apps to use objects during their operation, but remain conformant with specs during transfer
Response.prototype.serializeHeaders = function() {
	for (var k in this.headers) {
		this.headers[k] = local.httpHeaders.serialize(k, this.headers[k]);
	}
};

// EXPORTED
// calls any registered header deserialization functions
// - enables apps to use objects during their operation, but remain conformant with specs during transfer
Response.prototype.deserializeHeaders = function() {
	for (var k in this.headers) {
		var parsedHeader = local.httpHeaders.deserialize(k, this.headers[k]);
		if (parsedHeader && typeof parsedHeader != 'string') {
			this.parsedHeaders[k] = parsedHeader;
		}
	}
};

// writes the header to the response
// - emits the 'headers' event
Response.prototype.writeHead = function(status, reason, headers) {
	if (!this.isConnOpen)
		return this;
	this.status = status;
	this.reason = reason;
	if (headers) {
		for (var k in headers) {
			if (headers.hasOwnProperty(k))
				this.setHeader(k, headers[k]);
		}
	}
	this.serializeHeaders();

	this.emit('headers', this);
	return this;
};

// sends data over the stream
// - emits the 'data' event
Response.prototype.write = function(data) {
	if (!this.isConnOpen)
		return this;
	if (typeof data != 'string') {
		data = local.contentTypes.serialize(this.headers['content-type'], data);
	}
	this.emit('data', data);
	return this;
};

// ends the response stream
// - `data`: optional mixed, to write before ending
// - emits 'end' and 'close' events
Response.prototype.end = function(data) {
	if (!this.isConnOpen)
		return this;
	if (typeof data != 'undefined')
		this.write(data);
	this.emit('end');
	this.close();
	return this;
};

// closes the stream, aborting if not yet finished
// - emits 'close' event
Response.prototype.close = function() {
	if (!this.isConnOpen)
		return this;
	this.isConnOpen = false;
	this.emit('close');

	// :TODO: when events are suspended, this can cause problems
	//        maybe put these "removes" in a 'close' listener?
	// this.removeAllListeners('headers');
	// this.removeAllListeners('data');
	// this.removeAllListeners('end');
	// this.removeAllListeners('close');
	return this;
};// Server
// ======
// EXPORTED
// core type for all servers
// - should be used as a prototype
function Server(config) {
	this.config = { domain: null, log: false };
	if (config) {
		for (var k in config)
			this.config[k] = config[k];
	}
}
local.Server = Server;

Server.prototype.getDomain = function() { return this.config.domain; };
Server.prototype.getUrl = function() { return 'httpl://' + this.config.domain; };

Server.prototype.debugLog = function() {
	if (!this.config.log) return;
	var args = [this.config.domain].concat([].slice.call(arguments));
	console.debug.apply(console, args);
};

// Local request handler
// - should be overridden
Server.prototype.handleLocalRequest = function(request, response) {
	console.warn('handleLocalRequest not defined', this);
	response.writeHead(500, 'server not implemented');
	response.end();
};

// Called before server destruction
// - may be overridden
// - executes syncronously; does not wait for cleanup to finish
Server.prototype.terminate = function() {
};


// BridgeServer
// ============
// EXPORTED
// Core type for all servers which pipe requests between separated namespaces (eg WorkerBridgeServer, RTCBridgeServer)
// - Should be used as a prototype
// - Provides HTTPL implementation using the channel methods (which should be overridden by the subclasses)
// - Underlying channel must be:
//   - reliable
//   - order-guaranteed
// - Underlying channel is assumed not to be:
//   - multiplexed
// - :NOTE: WebRTC's SCTP should eventually support multiplexing, in which case RTCBridgeServer should
//   abstract multiple streams into the one "channel" to prevent head-of-line blocking
function BridgeServer(config) {
	Server.call(this, config);

	this.sidCounter = 1;
	this.incomingStreams = {}; // maps sid -> request/response stream
	// ^ only contains active streams (closed streams are deleted)
	this.incomingStreamsBuffer = {}; // maps sid -> {nextMid:, cache:{}}
	this.outgoingStreams = {}; // like `incomingStreams`, but for requests & responses that are sending out data
	this.msgBuffer = []; // buffer of messages kept until channel is active
	this.isReorderingMessages = false;
}
BridgeServer.prototype = Object.create(Server.prototype);
local.BridgeServer = BridgeServer;

// Turns on/off message numbering and the HOL-blocking reorder protocol
BridgeServer.prototype.useMessageReordering = function(v) {
	this.debugLog('turning '+(v?'on':'off')+' reordering');
	this.isReorderingMessages = !!v;
};

// Returns true if the channel is ready for activity
// - should be overridden
// - returns boolean
BridgeServer.prototype.isChannelActive = function() {
	console.warn('isChannelActive not defined', this);
	return false;
};

// Sends a single message across the channel
// - should be overridden
// - `msg`: required string
BridgeServer.prototype.channelSendMsg = function(msg) {
	console.warn('channelSendMsg not defined', this, msg);
};

// Remote request handler
// - should be overridden
BridgeServer.prototype.handleRemoteRequest = function(request, response) {
	console.warn('handleRemoteRequest not defined', this);
	response.writeHead(500, 'server not implemented');
	response.end();
};

// Sends messages that were buffered while waiting for the channel to setup
// - should be called by the subclass if there's any period between creation and channel activation
BridgeServer.prototype.flushBufferedMessages = function() {
	this.debugLog('FLUSHING MESSAGES', this, JSON.stringify(this.msgBuffer));
	this.msgBuffer.forEach(function(msg) {
		this.channelSendMsg(msg);
	}, this);
	this.msgBuffer.length = 0;
};

// Helper which buffers messages when the channel isnt active
BridgeServer.prototype.channelSendMsgWhenReady = function(msg) {
	if (!this.isChannelActive()) {
		// Buffer messages if not ready
		this.msgBuffer.push(msg);
	} else {
		this.channelSendMsg(msg);
	}
};

// Local request handler
// - pipes the request directly to the remote namespace
BridgeServer.prototype.handleLocalRequest = function(request, response) {
	// Build message
	var sid = this.sidCounter++;
	var msg = {
		sid: sid,
		mid: (this.isReorderingMessages) ? 1 : undefined,
		method: request.method,
		path: request.path,
		query: request.query,
		headers: request.headers
	};

	// Hold onto streams
	this.outgoingStreams[msg.sid] = request;
	this.incomingStreams[-msg.sid] = response; // store response stream in anticipation of the response messages

	// Send over the channel
	this.channelSendMsgWhenReady(JSON.stringify(msg));

	// Wire up request stream events
	var this2 = this;
	var midCounter = msg.mid;
	request.on('data',  function(data) { this2.channelSendMsgWhenReady(JSON.stringify({ sid: sid, mid: (midCounter) ? ++midCounter : undefined, body: data })); });
	request.on('end', function()       { this2.channelSendMsgWhenReady(JSON.stringify({ sid: sid, mid: (midCounter) ? ++midCounter : undefined, end: true })); });
	request.on('close', function()     { delete this2.outgoingStreams[msg.sid]; });
};

// Called before server destruction
// - may be overridden
// - executes syncronously; does not wait for cleanup to finish
BridgeServer.prototype.terminate = function() {
	Server.prototype.terminate.call(this);
	for (var sid in this.incomingStreams) {
		this.incomingStreams[sid].end();
	}
	for (sid in this.outgoingStreams) {
		this.outgoingStreams[sid].end();
	}
	this.incomingStreams = this.outgoingStreams = {};
};

// HTTPL implementation for incoming messages
// - should be called by subclasses on incoming messages
BridgeServer.prototype.onChannelMessage = function(msg) {
	// Validate and parse JSON
	if (typeof msg == 'string') {
		if (!validateJson(msg)) {
			console.warn('Dropping malformed HTTPL message', msg, this);
			return;
		}
		msg = JSON.parse(msg);
	}
	if (!validateHttplMessage(msg)) {
		console.warn('Dropping malformed HTTPL message', msg, this);
		return;
	}

	// Do input buffering if the message is numbered
	if (msg.mid) {
		// Create the buffer
		if (!this.incomingStreamsBuffer[msg.sid]) {
			this.incomingStreamsBuffer[msg.sid] = {
				nextMid: 1,
				cache: {}
			};
		}
		// Cache (block at HOL) if not next in line
		if (this.incomingStreamsBuffer[msg.sid].nextMid != msg.mid) {
			this.incomingStreamsBuffer[msg.sid].cache[msg.mid] = msg;
			return;
		}
	}

	// Get/create stream
	var stream = this.incomingStreams[msg.sid];
	if (!stream) {
		// Incoming requests have a positive sid
		if (msg.sid > 0) {
			// Create request & response
			var request = new local.Request({
				method: msg.method,
				path: msg.path,
				query: msg.query,
				headers: msg.headers
			});
			var response = new local.Response();

			// Wire response into the stream
			var this2 = this;
			var resSid = -(msg.sid);
			var midCounter = (this.isReorderingMessages) ? 1 : undefined;
			response.on('headers', function() {
				this2.channelSendMsg(JSON.stringify({
					sid: resSid,
					mid: (midCounter) ? midCounter++ : undefined,
					status: response.status,
					reason: response.reason,
					headers: response.headers,
				}));
			});
			response.on('data',  function(data) {
				this2.channelSendMsg(JSON.stringify({ sid: resSid, mid: (midCounter) ? midCounter++ : undefined, body: data }));
			});
			response.on('close', function() {
				this2.channelSendMsg(JSON.stringify({ sid: resSid, mid: (midCounter) ? midCounter++ : undefined, end: true }));
				delete this2.outgoingStreams[resSid];
			});

			// Hold onto the streams
			stream = this.incomingStreams[msg.sid] = request;
			this.outgoingStreams[resSid] = response;

			// Pass on to the request handler
			this.handleRemoteRequest(request, response);
		}
		// Incoming responses have a negative sid
		else {
			// There should have been an incoming stream
			// (incoming response streams are created locally on remote request dispatches)
			console.warn('Dropping unexpected HTTPL response message', msg, this);
			return;
		}
	}

	// {status: [int]} -> write head
	if (msg.sid < 0 && typeof msg.status != 'undefined') {
		stream.writeHead(msg.status, msg.reason, msg.headers);
	}

	// {body: [String]} -> write to stream body
	if (msg.body) {
		stream.write(msg.body);
	}

	// {end: true} -> close stream
	if (msg.end) {
		stream.end();
		stream.close();
		delete this.incomingStreams[msg.sid];
		delete this.incomingStreamsBuffer[msg.sid];
		return;
	}

	// Check the cache if the message is numbered for reordering
	if (msg.mid) {
		// Is the next message cached?
		var nextmid = ++this.incomingStreamsBuffer[msg.sid].nextMid;
		if (this.incomingStreamsBuffer[msg.sid].cache[nextmid]) {
			// Process it now
			var cachedmsg = this.incomingStreamsBuffer[msg.sid].cache[nextmid];
			delete this.incomingStreamsBuffer[msg.sid].cache[nextmid];
			this.onChannelMessage(cachedmsg);
		}
	}
};

// This validator is faster than doing a try/catch block
// http://jsperf.com/check-json-validity-try-catch-vs-regex
function validateJson(str) {
	if (str === '') {
		return false;
	}
	str = str.replace(/\\./g, '@').replace(/"[^"\\\n\r]*"/g, '');
	return (/^[,:{}\[\]0-9.\-+Eaeflnr-u \n\r\t]*$/).test(str);
}

function validateHttplMessage(parsedmsg) {
	if (!parsedmsg)
		return false;
	if (isNaN(parsedmsg.sid))
		return false;
	return true;
}// WorkerBridgeServer
// ============
// EXPORTED
// wrapper for servers run within workers
// - `config.src`: required URL
// - `config.serverFn`: optional function to replace handleRemoteRequest
// - `config.shared`: boolean, should the workerserver be shared?
// - `config.namespace`: optional string, what should the shared worker be named?
//   - defaults to `config.src` if undefined
// - `config.log`: optional bool, enables logging of all message traffic
function WorkerBridgeServer(config) {
	if (!config || !config.src)
		throw new Error("WorkerBridgeServer requires config with `src` attribute.");
	local.BridgeServer.call(this, config);
	this.isActive = false; // when true, ready for activity
	this.hasHostPrivileges = true; // do we have full control over the worker?
	// ^ set to false by the ready message of a shared worker (if we're not the first page to connect)
	if (config.serverFn) {
		this.configServerFn = config.serverFn;
		delete this.config.serverFn; // clear out the function from config, so we dont get an error when we send config to the worker
	}

	// Prep config
	if (!this.config.domain) { // assign a temporary label for logging if no domain is given yet
		this.config.domain = '<'+this.config.src.slice(0,40)+'>';
	}
	this.config.environmentHost = window.location.host; // :TODO: needed? I think workers can access this directly

	// Initialize the worker
	if (this.config.shared) {
		this.worker = new SharedWorker(config.src, config.namespace);
		this.worker.port.start();
	} else {
		this.worker = new Worker(config.src);
	}

	// Setup the incoming message handler
	this.getPort().addEventListener('message', (function(event) {
		var message = event.data;
		if (!message)
			return console.error('Invalid message from worker: Payload missing', this, event);
		if (this.config.log) { this.debugLog('received from worker', message); }

		// Handle messages with an `op` field as worker-control packets rather than HTTPL messages
		switch (message.op) {
			case 'ready':
				// Worker can now accept commands
				this.onWorkerReady(message.body);
				break;
			case 'log':
				this.onWorkerLog(message.body);
				break;
			case 'terminate':
				this.terminate();
				break;
			default:
				// If no 'op' field is given, treat it as an HTTPL request and pass onto our BridgeServer parent method
				this.onChannelMessage(message);
				break;
		}
	}).bind(this));
}
WorkerBridgeServer.prototype = Object.create(local.BridgeServer.prototype);
local.WorkerBridgeServer = WorkerBridgeServer;

// Returns the worker's messaging interface
// - varies between shared and normal workers
WorkerBridgeServer.prototype.getPort = function() {
	return this.worker.port ? this.worker.port : this.worker;
};

WorkerBridgeServer.prototype.terminate = function() {
	BridgeServer.prototype.terminate.call(this);
	this.worker.terminate();
	this.worker = null;
	this.isActive = false;
};

// Returns true if the channel is ready for activity
// - returns boolean
WorkerBridgeServer.prototype.isChannelActive = function() {
	return this.isActive;
};

// Sends a single message across the channel
// - `msg`: required string
WorkerBridgeServer.prototype.channelSendMsg = function(msg) {
	if (this.config.log) { this.debugLog('sending to worker', msg); }
	this.getPort().postMessage(msg);
};

// Remote request handler
// - should be overridden
BridgeServer.prototype.handleRemoteRequest = function(request, response) {
	if (this.configServerFn) {
		this.configServerFn.call(this, request, response, this);
	} else {
		response.writeHead(500, 'server not implemented');
		response.end();
	}
};

// Starts normal functioning
// - called when the local.js signals that it has finished loading
WorkerBridgeServer.prototype.onWorkerReady = function(message) {
	this.hasHostPrivileges = message.hostPrivileges;
	if (this.hasHostPrivileges) {
		// Send config
		this.channelSendMsg({ op: 'configure', body: this.config });
	}
	this.isActive = true;
	this.flushBufferedMessages();
};

// Logs message data from the worker
WorkerBridgeServer.prototype.onWorkerLog = function(message) {
	if (!message)
		return;
	if (!Array.isArray(message))
		return console.error('Received invalid "log" operation: Payload must be an array', message);

	var type = message.shift();
	var args = ['['+this.config.domain+']'].concat(message);
	switch (type) {
		case 'error':
			console.error.apply(console, args);
			break;
		case 'warn':
			console.warn.apply(console, args);
			break;
		default:
			console.log.apply(console, args);
			break;
	}
};// WebRTC Peer Server
// ==================

(function() {

	var peerConstraints = {
		// optional: [{ RtpDataChannels: true }]
		optional: [{DtlsSrtpKeyAgreement: true}]
	};
	var defaultIceServers = { iceServers: [{ url: 'stun:stun.l.google.com:19302' }] };

	function randomStreamId() {
		return Math.round(Math.random()*10000);
	}

	// Browser compat
	var __env = (typeof window != 'undefined') ? window : self;
	var RTCSessionDescription = __env.mozRTCSessionDescription || __env.RTCSessionDescription;
	var RTCPeerConnection = __env.mozRTCPeerConnection || __env.webkitRTCPeerConnection || __env.RTCPeerConnection;
	var RTCIceCandidate = __env.mozRTCIceCandidate || __env.RTCIceCandidate;


	// RTCBridgeServer
	// ===============
	// EXPORTED
	// server wrapper for WebRTC connections
	// - `config.peer`: required string, who we are connecting to (a valid peer domain)
	// - `config.relay`: required local.Relay
	// - `config.initiate`: optional bool, if true will initiate the connection processes
	// - `config.loopback`: optional bool, is this the local host? If true, will connect to self
	// - `config.retryTimeout`: optional number, time (in ms) before a connection is aborted and retried (defaults to 15000)
	// - `config.retries`: optional number, number of times to retry before giving up (defaults to 3)
	// - `config.log`: optional bool, enables logging of all message traffic
	function RTCBridgeServer(config) {
		// Config
		var self = this;
		if (!config) config = {};
		if (!config.peer) throw new Error("`config.peer` is required");
		if (!config.relay) throw new Error("`config.relay` is required");
		if (typeof config.retryTimeout == 'undefined') config.retryTimeout = 15000;
		if (typeof config.retries == 'undefined') config.retries = 3;
		local.BridgeServer.call(this, config);
		local.util.mixinEventEmitter(this);

		// Parse config.peer
		var peerd = local.parsePeerDomain(config.peer);
		if (!peerd) {
			throw new Error("Invalid peer URL: "+config.peer);
		}
		this.peerInfo = peerd;

		// Internal state
		this.isConnecting     = true;
		this.isOfferExchanged = false;
		this.isConnected      = false;
		this.isTerminated     = false;
		this.candidateQueue   = []; // cant add candidates till we get the offer
		this.offerNonce       = 0; // a random number used to decide who takes the lead if both nodes send an offer
		this.retriesLeft      = config.retries;
		this.rtcPeerConn      = null;
		this.rtcDataChannel   = null;

		// Create the peer connection
		this.createPeerConn();

		if (this.config.loopback) {
			// Setup to serve self
			this.isOfferExchanged = true;
			onHttplChannelOpen.call(this);
		} else {
			// Reorder messages until the WebRTC session is established
			this.useMessageReordering(true);

			if (this.config.initiate) {
				// Initiate event will be picked up by the peer
				// If they want to connect, they'll send an answer back
				this.sendOffer();
			}
		}
	}
	RTCBridgeServer.prototype = Object.create(local.BridgeServer.prototype);
	local.RTCBridgeServer = RTCBridgeServer;

	RTCBridgeServer.prototype.getPeerInfo = function() { return this.peerInfo; };
	RTCBridgeServer.prototype.terminate = function(opts) {
		BridgeServer.prototype.terminate.call(this);
		this.isTerminated = true;
		if (this.isConnecting || this.isConnected) {
			if (!(opts && opts.noSignal)) {
				this.signal({ type: 'disconnect' });
			}
			this.isConnecting = false;
			this.isConnected = false;
			this.destroyPeerConn();
			this.emit('disconnected', Object.create(this.peerInfo), this);
		}
	};

	// Returns true if the channel is ready for activity
	// - returns boolean
	RTCBridgeServer.prototype.isChannelActive = function() {
		return true;// this.isConnected; - we send messages over the relay before connection
	};

	// Sends a single message across the channel
	// - `msg`: required string
	RTCBridgeServer.prototype.channelSendMsg = function(msg) {
		if (this.config.loopback) {
			this.onChannelMessage(msg);
		} else if (!this.isConnected) {
			this.signal({
				type: 'httpl',
				data: msg
			});
		} else {
			this.rtcDataChannel.send(msg);
		}
	};

	// Remote request handler
	RTCBridgeServer.prototype.handleRemoteRequest = function(request, response) {
		var server = this.config.relay.getServer();
		if (server && typeof server == 'function') {
			server.call(this, request, response, this);
		} else if (server && server.handleRemoteRequest) {
			server.handleRemoteRequest(request, response, this);
		} else {
			response.writeHead(500, 'not implemented');
			response.end();
		}
	};

	// HTTPL channel event handlers
	// -

	function onHttplChannelMessage(msg) {
		this.debugLog('HTTPL CHANNEL MSG', msg);

		// Pass on to method in parent prototype
		this.onChannelMessage(msg.data);
	}

	function onHttplChannelOpen(e) {
		this.debugLog('HTTPL CHANNEL OPEN', e);

		// :HACK: canary appears to drop packets for a short period after the datachannel is made ready

		var self = this;
		setTimeout(function() {
			console.warn('using rtcDataChannel delay hack');

			// Update state
			self.isConnecting = false;
			self.isConnected = true;

			// Can now rely on sctp ordering
			self.useMessageReordering(false);

			// Emit event
			self.emit('connected', Object.create(self.peerInfo), self);
		}, 1000);
	}

	function onHttplChannelClose(e) {
		this.debugLog('HTTPL CHANNEL CLOSE', e);
		this.terminate({ noSignal: true });
	}

	function onHttplChannelError(e) {
		this.debugLog('HTTPL CHANNEL ERR', e);
		this.emit('error', Object.create(this.peerInfo, { error: { value: e } }), this);
	}

	// Signal relay behaviors
	// -

	RTCBridgeServer.prototype.onSignal = function(msg) {
		var self = this;

		switch (msg.type) {
			case 'disconnect':
				// Peer's dead, shut it down
				this.terminate({ noSignal: true });
				break;

			case 'candidate':
				this.debugLog('GOT CANDIDATE', msg.candidate);
				// Received address info from the peer
				if (!this.isOfferExchanged) {
					// Store for when offer/answer exchange has finished
					this.candidateQueue.push(msg.candidate);
				} else {
					// Pass into the peer connection
					this.rtcPeerConn.addIceCandidate(new RTCIceCandidate({ candidate: msg.candidate }));
				}
				break;

			case 'offer':
				// Received a session offer from the peer
				this.debugLog('GOT OFFER', msg);
				if (this.isConnected) {
					this.debugLog('RECEIVED AN OFFER WHEN BELIEVED TO BE CONNECTED, DROPPING');
					return;
				}

				// Abandon ye' hope if no rtc support
				if (typeof RTCSessionDescription == 'undefined') {
					return;
				}

				// Emit event
				if (!this.isOfferExchanged) {
					this.emit('connecting', Object.create(this.peerInfo), this);
				}

				// Guard against an offer race conditions
				if (this.config.initiate) {
					// Leader conflict - compare nonces
					this.debugLog('LEADER CONFLICT DETECTED, COMPARING NONCES', 'MINE=', this.offerNonce, 'THEIRS=', msg.nonce);
					if (this.offerNonce < msg.nonce) {
						// Reset into follower role
						this.debugLog('RESETTING INTO FOLLOWER ROLE');
						this.config.initiate = false;
						this.resetPeerConn();
					}
				}

				// Watch for reset offers from the leader
				if (!this.config.initiate && this.isOfferExchanged) {
					if (this.retriesLeft > 0) {
						this.retriesLeft--;
						this.debugLog('RECEIVED A NEW OFFER, RESETTING AND RETRYING. RETRIES LEFT:', this.retriesLeft);
						this.resetPeerConn();
					} else {
						this.debugLog('RECEIVED A NEW OFFER, NO RETRIES LEFT. GIVING UP.');
						this.terminate();
						return;
					}
				}

				// Update the peer connection
				var desc = new RTCSessionDescription({ type: 'offer', sdp: msg.sdp });
				this.rtcPeerConn.setRemoteDescription(desc);

				// Burn the ICE candidate queue
				handleOfferExchanged.call(this);

				// Send an answer
				this.rtcPeerConn.createAnswer(
					function(desc) {
						self.debugLog('CREATED ANSWER', desc);

						// Store the SDP
						desc.sdp = increaseSDP_MTU(desc.sdp);
						self.rtcPeerConn.setLocalDescription(desc);

						// Send answer msg
						self.signal({ type: 'answer', sdp: desc.sdp });
					},
					function(error) {
						self.emit('error', Object.create(this.peerInfo, { error: { value: error } }), self);
					}
				);
				break;

			case 'answer':
				// Received session confirmation from the peer
				this.debugLog('GOT ANSWER', msg);

				// Update the peer connection
				this.rtcPeerConn.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));

				// Burn the ICE candidate queue
				handleOfferExchanged.call(this);
				break;

			case 'httpl':
				// Received HTTPL traffic from the peer
				this.debugLog('GOT HTTPL RELAY', msg);

				// Handle
				this.onChannelMessage(msg.data);
				break;

			default:
				console.warn('RTCBridgeServer - Unrecognized signal message from relay', msg);
		}
	};

	// Helper to send a message to peers on the relay
	RTCBridgeServer.prototype.signal = function(msg) {
		// Send the message through our relay
		var self = this;
		var response_ = this.config.relay.signal(this.config.peer, msg);
		response_.fail(function(res) {
			if (res.status == 404 && !self.isTerminated) {
				// Peer not online, shut down for now. We can try to reconnect later
				for (var k in self.incomingStreams) {
					self.incomingStreams[k].writeHead(404, 'not found').end();
				}
				self.terminate({ noSignal: true });
				local.removeServer(self.config.domain);
			}
		});
		return response_;
	};

	// Helper sets up the peer connection
	RTCBridgeServer.prototype.createPeerConn = function() {
		if (!this.rtcPeerConn && typeof RTCPeerConnection != 'undefined') {
			var servers = this.config.iceServers || defaultIceServers;
			this.rtcPeerConn = new RTCPeerConnection(servers, peerConstraints);
			this.rtcPeerConn.onicecandidate             = onIceCandidate.bind(this);
			// this.rtcPeerConn.onicechange                = onIceConnectionStateChange.bind(this);
			this.rtcPeerConn.oniceconnectionstatechange = onIceConnectionStateChange.bind(this);
			this.rtcPeerConn.onsignalingstatechange     = onSignalingStateChange.bind(this);
			this.rtcPeerConn.ondatachannel              = onDataChannel.bind(this);
		}
	};

	// Helper tears down the peer conn
	RTCBridgeServer.prototype.destroyPeerConn = function(suppressEvents) {
		if (this.rtcDataChannel) {
			this.rtcDataChannel.close();
			if (suppressEvents) {
				this.rtcDataChannel.onopen    = null;
				this.rtcDataChannel.onclose   = null;
				this.rtcDataChannel.onerror   = null;
				this.rtcDataChannel.onmessage = null;
			}
			this.rtcDataChannel = null;
		}
		if (this.rtcPeerConn) {
			this.rtcPeerConn.close();
			if (suppressEvents) {
				this.rtcPeerConn.onicecandidate             = null;
				// this.rtcPeerConn.onicechange                = null;
				this.rtcPeerConn.oniceconnectionstatechange = null;
				this.rtcPeerConn.onsignalingstatechange     = null;
				this.rtcPeerConn.ondatachannel              = null;
			}
			this.rtcPeerConn = null;
		}
	};

	// Helper restarts the connection process
	RTCBridgeServer.prototype.resetPeerConn = function(suppressEvents) {
		this.destroyPeerConn(true);
		this.createPeerConn();
		this.candidateQueue.length = 0;
		this.isOfferExchanged = false;
	};

	// Helper initiates a timeout clock for the connection process
	function initConnectTimeout() {
		var self = this;
		setTimeout(function() {
			// Leader role only
			if (self.config.initiate && self.isConnected === false) {
				if (self.retriesLeft > 0) {
					self.retriesLeft--;
					self.debugLog('CONNECTION TIMED OUT, RESTARTING. TRIES LEFT:', self.retriesLeft);
					// Reset
					self.resetPeerConn();
					self.sendOffer();
				} else {
					// Give up
					self.debugLog('CONNECTION TIMED OUT, GIVING UP');
					self.resetPeerConn();
					// ^ resets but doesn't terminate - can try again with sendOffer()
				}
			}
		}, this.config.retryTimeout);
	}

	// Helper initiates a session with peers on the relay
	RTCBridgeServer.prototype.sendOffer = function() {
		var self = this;
		if (typeof RTCPeerConnection == 'undefined') {
			return;
		}

		// Start the clock
		initConnectTimeout.call(this);

		// Create the HTTPL data channel
		this.rtcDataChannel = this.rtcPeerConn.createDataChannel('httpl', { reliable: true });
		this.rtcDataChannel.onopen     = onHttplChannelOpen.bind(this);
		this.rtcDataChannel.onclose    = onHttplChannelClose.bind(this);
		this.rtcDataChannel.onerror    = onHttplChannelError.bind(this);
		this.rtcDataChannel.onmessage  = onHttplChannelMessage.bind(this);

		// Generate offer
		this.rtcPeerConn.createOffer(
			function(desc) {
				self.debugLog('CREATED OFFER', desc);

				// Store the SDP
				desc.sdp = increaseSDP_MTU(desc.sdp);
				self.rtcPeerConn.setLocalDescription(desc);

				// Generate an offer nonce
				self.offerNonce = Math.round(Math.random() * 10000000);

				// Send offer msg
				self.signal({ type: 'offer', sdp: desc.sdp, nonce: self.offerNonce });
			},
			function(error) {
				self.emit('error', Object.create(this.peerInfo, { error: { value: error } }), self);
			}
		);
		// Emit 'connecting' on next tick
		// (next tick to make sure objects creating us get a chance to wire up the event)
		setTimeout(function() {
			self.emit('connecting', Object.create(self.peerInfo), self);
		}, 0);
	};

	// Helper called whenever we have a remote session description
	// (candidates cant be added before then, so they're queued in case they come first)
	function handleOfferExchanged() {
		var self = this;
		this.isOfferExchanged = true;
		this.candidateQueue.forEach(function(candidate) {
			self.rtcPeerConn.addIceCandidate(new RTCIceCandidate({ candidate: candidate }));
		});
		this.candidateQueue.length = 0;
	}

	// Called by the RTCPeerConnection when we get a possible connection path
	function onIceCandidate(e) {
		if (e && e.candidate) {
			this.debugLog('FOUND ICE CANDIDATE', e.candidate);
			// send connection info to peers on the relay
			this.signal({ type: 'candidate', candidate: e.candidate.candidate });
		}
	}

	// Called by the RTCPeerConnection on connectivity events
	function onIceConnectionStateChange(e) {
		if (!!e.target && e.target.iceConnectionState === 'disconnected') {
			this.debugLog('ICE CONNECTION STATE CHANGE: DISCONNECTED', e);
			this.terminate({ noSignal: true });
		}
	}

	// Called by the RTCPeerConnection on connectivity events
	function onSignalingStateChange(e) {
		if(e.target && e.target.signalingState == "closed"){
			this.debugLog('SIGNALING STATE CHANGE: DISCONNECTED', e);
			this.terminate({ noSignal: true });
		}
	}

	// Called by the RTCPeerConnection when a datachannel is created (receiving party only)
	function onDataChannel(e) {
		this.debugLog('DATA CHANNEL PROVIDED', e);
		this.rtcDataChannel = e.channel;
		this.rtcDataChannel.onopen     = onHttplChannelOpen.bind(this);
		this.rtcDataChannel.onclose    = onHttplChannelClose.bind(this);
		this.rtcDataChannel.onerror    = onHttplChannelError.bind(this);
		this.rtcDataChannel.onmessage  = onHttplChannelMessage.bind(this);
	}

	// Increases the bandwidth allocated to our connection
	// Thanks to michellebu (https://github.com/michellebu/reliable)
	var higherBandwidthSDPRE = /b\=AS\:([\d]+)/i;
	function increaseSDP_MTU(sdp) {
		return sdp;
		// return sdp.replace(higherBandwidthSDPRE, 'b=AS:102400'); // 100 Mbps
	}


	// Relay
	// =====
	// EXPORTED
	// Helper class for managing a peer web relay provider
	// - `config.provider`: optional string, the relay provider
	// - `config.serverFn`: optional function, the function for peerservers' handleRemoteRequest
	// - `config.app`: optional string, the app to join as (defaults to window.location.host)
	// - `config.stream`: optional number, the stream id (defaults to pseudo-random)
	// - `config.ping`: optional number, sends a ping to self via the relay at the given interval (in ms) to keep the stream alive
	//   - set to false to disable keepalive pings
	//   - defaults to 45000
	// - `config.retryTimeout`: optional number, time (in ms) before a peer connection is aborted and retried (defaults to 15000)
	// - `config.retries`: optional number, number of times to retry a peer connection before giving up (defaults to 5)
	function Relay(config) {
		if (!config) config = {};
		if (!config.app) config.app = window.location.host;
		if (typeof config.stream == 'undefined') { config.stream = randomStreamId(); this.autoRetryStreamTaken = true; }
		if (typeof config.ping == 'undefined') { config.ping = 45000; }
		this.config = config;
		local.util.mixinEventEmitter(this);

		// State
		this.myPeerDomain = null;
		this.connectedToRelay = false;
		this.userId = null;
		this.accessToken = null;
		this.bridges = {};
		this.pingInterval = null;
		this.registeredLinks = null;
		this.relayEventStream = null;

		// Internal helpers
		this.messageFromAuthPopupHandler = null;

		// Agents
		this.relayService = null;
		this.usersCollection = null;
		this.relayItem = null;

		// Setup provider config
		if (config.provider) {
			this.setProvider(config.provider);
		}

		// Bind window close behavior
		window.addEventListener('beforeunload', this.onPageClose.bind(this));
	}
	local.Relay = Relay;

	// Sets the access token and triggers a connect flow
	// - `token`: required String?, the access token (null if denied access)
	// - `token` should follow the form '<userId>:<'
	Relay.prototype.setAccessToken = function(token) {
		if (token) {
			// Extract user-id from the access token
			var tokenParts = token.split(':');
			if (tokenParts.length !== 2) {
				throw new Error('Invalid access token');
			}

			// Store
			this.userId = tokenParts[0];
			this.accessToken = token;
			this.relayService.setRequestDefaults({ headers: { authorization: 'Bearer '+token }});
			this.usersCollection.setRequestDefaults({ headers: { authorization: 'Bearer '+token }});

			// Try to validate our access now
			var self = this;
			this.relayItem = this.relayService.follow({
				rel:    'item gwr.io/relay',
				user:   this.getUserId(),
				app:    this.getApp(),
				stream: this.getStreamId(),
				nc:     Date.now() // nocache
			});
			this.relayItem.resolve().then( // a successful HEAD request will verify access
				function() {
					// Emit an event
					self.emit('accessGranted');
				},
				function(res) {
					// Handle error
					self.onRelayError({ event: 'error', data: res });
				}
			);
		} else {
			// Update state and emit event
			var hadToken = !!this.accessToken;
			this.userId = null;
			this.accessToken = null;
			if (hadToken) {
				this.emit('accessRemoved');
			}
		}
	};
	Relay.prototype.isListening     = function() { return this.connectedToRelay; };
	Relay.prototype.getDomain       = function() { return this.myPeerDomain; };
	Relay.prototype.getUserId       = function() { return this.userId; };
	Relay.prototype.getApp          = function() { return this.config.app; };
	Relay.prototype.setApp          = function(v) { this.config.app = v; };
	Relay.prototype.getStreamId     = function() { return this.config.stream; };
	Relay.prototype.setStreamId     = function(stream) { this.config.stream = stream; };
	Relay.prototype.getAccessToken  = function() { return this.accessToken; };
	Relay.prototype.getServer       = function() { return this.config.serverFn; };
	Relay.prototype.setServer       = function(fn) { this.config.serverFn = fn; };
	Relay.prototype.getRetryTimeout = function() { return this.config.retryTimeout; };
	Relay.prototype.setRetryTimeout = function(v) { this.config.retryTimeout = v; };
	Relay.prototype.getProvider     = function() { return this.config.provider; };
	Relay.prototype.setProvider     = function(providerUrl) {
		// Abort if already connected
		if (this.connectedToRelay) {
			throw new Error("Can not change provider while connected to the relay. Call stopListening() first.");
		}
		// Update config
		this.config.provider = providerUrl;
		this.providerDomain = local.parseUri(providerUrl).host;

		// Create APIs
		this.relayService = local.agent(this.config.provider);
		this.usersCollection = this.relayService.follow({ rel: 'gwr.io/user collection' });
	};

	// Gets an access token from the provider & user using a popup
	// - Best if called within a DOM click handler, as that will avoid popup-blocking
	Relay.prototype.requestAccessToken = function() {
		// Start listening for messages from the popup
		if (!this.messageFromAuthPopupHandler) {
			this.messageFromAuthPopupHandler = (function(e) {
				console.log('Received access token from '+e.origin);

				// Make sure this is from our popup
				var originUrld = local.parseUri(e.origin);
				var providerUrld = local.parseUri(this.config.provider);
				if (originUrld.authority !== providerUrld.authority) {
					return;
				}

				// Use this moment to switch to HTTPS, if we're using HTTP
				// - this occurs when the provider domain is given without a protocol, and the server is HTTPS
				// - failing to do so causes a redirect during the XHR calls to the relay, which violates a CORS condition
				if (this.config.provider != e.origin) {
					this.setProvider(e.origin);
				}

				// Update our token
				this.setAccessToken(e.data);

				// If given a null, emit denial event
				if (!e.data) {
					this.emit('accessDenied');
				}
			}).bind(this);
			window.addEventListener('message', this.messageFromAuthPopupHandler);
		}

		// Open interface in a popup
		// :HACK: because popup blocking can only be avoided by a syncronous popup call, we have to manually construct the url (it burns us)
		window.open(this.getProvider() + '/session/' + this.config.app);
	};

	// Fetches users from p2pw service
	// - opts.online: optional bool, only online users
	// - opts.trusted: optional bool, only users trusted by our session
	Relay.prototype.getUsers = function(opts) {
		var api = this.usersCollection;
		if (opts) {
			opts.rel = 'self';
			api = api.follow(opts);
		}
		return api.get({ accept: 'application/json' });
	};

	// Fetches a user from p2pw service
	// - `userId`: string
	Relay.prototype.getUser = function(userId) {
		return this.usersCollection.follow({ rel: 'item gwr.io/user', id: userId }).get({ accept: 'application/json' });
	};

	// Sends (or stores to send) links in the relay's registry
	Relay.prototype.registerLinks = function(links) {
		this.registeredLinks = Array.isArray(links) ? links : [links];
		if (this.relayItem) {
			this.relayItem.dispatch({ method: 'PATCH', body: { links: this.registeredLinks }});
		}
	};

	// Creates a new agent with up-to-date links for the relay
	Relay.prototype.agent = function() {
		return this.relayService.follow({ rel: 'collection gwr.io/relay', links: 1 });
	};

	// Subscribes to the event relay and begins handling signals
	// - enables peers to connect
	Relay.prototype.startListening = function() {
		var self = this;
		// Make sure we have an access token
		if (!this.getAccessToken()) {
			return;
		}
		// Update "src" object, for use in signal messages
		this.myPeerDomain = this.makeDomain(this.getUserId(), this.config.app, this.config.stream);
		// Connect to the relay stream
		this.relayItem = this.relayService.follow({
			rel:    'item gwr.io/relay',
			user:   this.getUserId(),
			app:    this.getApp(),
			stream: this.getStreamId(),
			nc:     Date.now() // nocache
		});
		this.relayItem.subscribe()
			.then(
				function(stream) {
					// Update state
					__peer_relay_registry[self.providerDomain] = self;
					self.relayEventStream = stream;
					self.connectedToRelay = true;
					stream.response_.then(function(response) {
						// Setup links
						if (self.registeredLinks) {
							// We had links stored from before, send them now
							self.registerLinks(self.registeredLinks);
						}

						// Emit event
						self.emit('listening');
						return response;
					});

					// Setup handlers
					stream.on('signal', self.onSignal.bind(self));
					stream.on('error', self.onRelayError.bind(self));
					stream.on('close', self.onRelayClose.bind(self));

					// Initiate the ping interval
					if (self.pingInterval) { clearInterval(self.pingInterval); }
					if (self.config.ping) {
						self.pingInterval = setInterval(function() {
							self.signal(self.getDomain(), { type: 'noop' });
						}, self.config.ping);
					}
				},
				function(err) {
					self.onRelayError({ event: 'error', data: err });
				}
			);
	};

	// Disconnects from the relay
	// - peers will no longer be able to connect
	Relay.prototype.stopListening = function() {
		if (this.connectedToRelay) {
			// Terminate any bridges that are mid-connection
			for (var domain in this.bridges) {
				if (this.bridges[domain].isConnecting) {
					this.bridges[domain].terminate();
				}
			}

			// Update state
			this.connectedToRelay = false;
			this.relayEventStream.close();
			this.relayEventStream = null;
			delete __peer_relay_registry[self.providerDomain];
		}
	};

	// Spawns an RTCBridgeServer and starts the connection process with the given peer
	// - `peerUrl`: required String, the domain/url of the target peer
	// - `config.initiate`: optional Boolean, should the server initiate the connection?
	//   - defaults to true
	//   - should only be false if the connection was already initiated by the opposite end
	// - `config.retryTimeout`: optional number, time (in ms) before a connection is aborted and retried (defaults to 15000)
	// - `config.retries`: optional number, number of times to retry before giving up (defaults to 5)
	Relay.prototype.connect = function(peerUrl, config) {
		if (!config) config = {};
		if (typeof config.initiate == 'undefined') config.initiate = true;

		// Make sure we're not already connected
		if (peerUrl in this.bridges) {
			return this.bridges[peerUrl];
		}

		// Parse the url
		var peerUrld = local.parseUri(peerUrl);
		var peerd = local.parsePeerDomain(peerUrld.authority);
		if (!peerd) {
			throw new Error("Invalid peer url given to connect(): "+peerUrl);
		}

		// Spawn new server
		var server = new local.RTCBridgeServer({
			peer:         peerUrl,
			initiate:     config.initiate,
			relay:        this,
			serverFn:     this.config.serverFn,
			loopback:     (peerUrld.authority == this.myPeerDomain),
			retryTimeout: config.retryTimeout || this.config.retryTimeout,
			retries:      config.retries || this.config.retries,
			log:          this.config.log || false
		});

		// Bind events
		server.on('connecting', this.emit.bind(this, 'connecting'));
		server.on('connected', this.emit.bind(this, 'connected'));
		server.on('disconnected', this.onBridgeDisconnected.bind(this));
		server.on('disconnected', this.emit.bind(this, 'disconnected'));
		server.on('error', this.emit.bind(this, 'error'));

		// Add to hostmap
		this.bridges[peerUrld.authority] = server;
		local.addServer(peerUrld.authority, server);

		return server;
	};

	Relay.prototype.signal = function(dst, msg) {
		if (!this.relayItem) {
			console.warn('Relay - signal() called before relay is connected');
			return;
		}
		var self = this;
		var response_ = this.relayItem.dispatch({ method: 'notify', body: { src: this.myPeerDomain, dst: dst, msg: msg } });
		response_.fail(function(res) {
			if (res.status == 401) {
				if (!self.accessToken) {
					return;
				}
				// Remove bad access token to stop reconnect attempts
				self.setAccessToken(null);
				// Fire event
				self.emit('accessInvalid');
			}
		});
		return response_;
	};

	Relay.prototype.onSignal = function(e) {
		if (!e.data || !e.data.src || !e.data.msg) {
			console.warn('discarding faulty signal message', err);
		}
		if (e.data.msg.type == 'noop') { return; } // used for heartbeats to keep the stream alive

		// Find bridge that represents this origin
		var domain = e.data.src;
		var bridgeServer = this.bridges[domain];

		// Does bridge exist?
		if (bridgeServer) {
			// Let bridge handle it
			bridgeServer.onSignal(e.data.msg);
		} else {
			if (e.data.msg.type == 'offer' || e.data.msg.type == 'httpl') {
				// Create a server to handle the signal
				bridgeServer = this.connect(domain, { initiate: false });
				bridgeServer.onSignal(e.data.msg);
			}
		}
	};

	Relay.prototype.onRelayError = function(e) {
		if (e.data && e.data.status == 423) { // locked
			// Update state
			this.relayEventStream = null;
			this.connectedToRelay = false;

			if (!this.autoRetryStreamTaken) {
				// Fire event
				this.emit('streamTaken');
			} else {
				// Auto-retry
				this.setStreamId(randomStreamId());
				this.startListening();
			}
		} else if (e.data && (e.data.status == 401 || e.data.status == 403)) { // unauthorized
			// Remove bad access token to stop reconnect attempts
			this.setAccessToken(null);
			// Fire event
			this.emit('accessInvalid');
		} else if (e.data && (e.data.status === 0 || e.data.status == 404 || e.data.status >= 500)) { // connection lost
			// Update state
			this.relayEventStream = null;
			this.connectedToRelay = false;

			// Attempt to reconnect in 2 seconds
			var self = this;
			setTimeout(function() {
				self.startListening();
				// Note - if this fails, an error will be rethrown and take us back here
			}, 2000);
		} else {
			// Fire event
			this.emit('error', { error: e.data });
		}
	};

	Relay.prototype.onRelayClose = function() {
		// Update state
		var wasConnected = this.connectedToRelay;
		this.connectedToRelay = false;
		if (self.pingInterval) { clearInterval(self.pingInterval); }

		// Fire event
		this.emit('notlistening');

		// Did we expect this close event?
		if (wasConnected) {
			// No, we should reconnect
			this.startListening();
		}
	};

	Relay.prototype.onBridgeDisconnected = function(data) {
		// Stop tracking bridges that close
		var bridge = this.bridges[data.domain];
		if (bridge) {
			delete this.bridges[data.domain];
			local.removeServer(data.domain);
		}
	};

	Relay.prototype.onPageClose = function() {
		var bridgeDomains = Object.keys(this.bridges);
		if (this.connectedToRelay && bridgeDomains.length !== 0) {
			// Collect connected peer destination info
			var dst = [];
			for (var domain in this.bridges) {
				dst.push(this.bridges[domain].config.peer);
			}

			// Send a synchronous disconnect signal to all connected peers
			var req = new XMLHttpRequest();
			req.open('NOTIFY', this.relayItem.context.url, false);
			req.setRequestHeader('Authorization', 'Bearer '+this.accessToken);
			req.setRequestHeader('Content-type', 'application/json');
			req.send(JSON.stringify({ src: this.myPeerDomain, dst: dst, msg: { type: 'disconnect' } }));
		}
	};

	Relay.prototype.makeDomain = function(user, app, stream) {
		return local.makePeerDomain(user, this.providerDomain, app, stream);
	};

})();// schemes
// =======
// EXPORTED
// dispatch() handlers, matched to the scheme in the request URIs
var schemes = {
	register: schemes__register,
	unregister: schemes__unregister,
	get: schemes__get
};
var schemes__registry = {};
local.schemes = schemes;

function schemes__register(scheme, handler) {
	if (scheme && Array.isArray(scheme)) {
		for (var i=0, ii=scheme.length; i < ii; i++)
			schemes__register(scheme[i], handler);
	} else
		schemes__registry[scheme] = handler;
}

function schemes__unregister(scheme) {
	delete schemes__registry[scheme];
}

function schemes__get(scheme) {
	return schemes__registry[scheme];
}


// HTTP
// ====
local.schemes.register(['http', 'https'], function(request, response) {
	// parse URL
	var urld = local.parseUri(request.url);

	// if a query was given in the options, mix it into the urld
	if (request.query) {
		var q = local.contentTypes.serialize('application/x-www-form-urlencoded', request.query);
		if (q) {
			if (urld.query) {
				urld.query    += '&' + q;
				urld.relative += '&' + q;
			} else {
				urld.query     =  q;
				urld.relative += '?' + q;
			}
		}
	}

	// assemble the final url
	var url = ((urld.protocol) ? (urld.protocol + '://') : '//') + urld.authority + urld.relative;

	// create the request
	var xhrRequest = new XMLHttpRequest();
	xhrRequest.open(request.method, url, true);
	if (request.binary) {
		xhrRequest.responseType = 'arraybuffer';
		if (request.stream)
			console.warn('Got HTTP/S request with binary=true and stream=true - sorry, not supported, binary responses must be buffered (its a browser thing)', request);
	}

	// set headers
	request.serializeHeaders();
	for (var k in request.headers) {
		if (request.headers[k] !== null && request.headers.hasOwnProperty(k))
			xhrRequest.setRequestHeader(k, request.headers[k]);
	}

	// buffer the body, send on end
	var body = '';
	request.on('data', function(data) { body += data; });
	request.on('end', function() { xhrRequest.send(body); });

	// abort on request close
	request.on('close', function() {
		if (xhrRequest.readyState !== XMLHttpRequest.DONE)
			xhrRequest.abort();
	});

	// register response handlers
	var streamPoller=0, lenOnLastPoll=0, headersSent = false;
	xhrRequest.onreadystatechange = function() {
		if (xhrRequest.readyState >= XMLHttpRequest.HEADERS_RECEIVED && !headersSent) {
			headersSent = true;

			// extract headers
			var headers = {};
			if (xhrRequest.status !== 0) {
				if (xhrRequest.getAllResponseHeaders()) {
					xhrRequest.getAllResponseHeaders().split("\n").forEach(function(h) {
						if (!h) { return; }
						var kv = h.replace('\r','').split(': ');
						headers[kv[0].toLowerCase()] = kv.slice(1).join(': ');
					});
				} else {
					// a bug in firefox causes getAllResponseHeaders to return an empty string on CORS
					// (not ideal, but) iterate the likely headers
					var extractHeader = function(k) {
						var v = xhrRequest.getResponseHeader(k);
						if (v)
							headers[k.toLowerCase()] = v.toLowerCase();
					};
					extractHeader('Accept-Ranges');
					extractHeader('Age');
					extractHeader('Allow');
					extractHeader('Cache-Control');
					extractHeader('Connection');
					extractHeader('Content-Encoding');
					extractHeader('Content-Language');
					extractHeader('Content-Length');
					extractHeader('Content-Location');
					extractHeader('Content-MD5');
					extractHeader('Content-Disposition');
					extractHeader('Content-Range');
					extractHeader('Content-Type');
					extractHeader('Date');
					extractHeader('ETag');
					extractHeader('Expires');
					extractHeader('Last-Modified');
					extractHeader('Link');
					extractHeader('Location');
					extractHeader('Pragma');
					extractHeader('Refresh');
					extractHeader('Retry-After');
					extractHeader('Server');
					extractHeader('Set-Cookie');
					extractHeader('Trailer');
					extractHeader('Transfer-Encoding');
					extractHeader('Vary');
					extractHeader('Via');
					extractHeader('Warning');
					extractHeader('WWW-Authenticate');
				}
			}

			response.writeHead(xhrRequest.status, xhrRequest.statusText, headers);

			// start polling for updates
			if (!response.binary) {
				// ^ browsers buffer binary responses, so dont bother streaming
				streamPoller = setInterval(function() {
					// new data?
					var len = xhrRequest.response.length;
					if (len > lenOnLastPoll) {
						var chunk = xhrRequest.response.slice(lenOnLastPoll);
						lenOnLastPoll = len;
						response.write(chunk);
					}
				}, 50);
			}
		}
		if (xhrRequest.readyState === XMLHttpRequest.DONE) {
			if (streamPoller)
				clearInterval(streamPoller);
			if (response.status !== 0 && xhrRequest.status === 0) {
				// a sudden switch to 0 (after getting a non-0) probably means a timeout
				console.debug('XHR looks like it timed out; treating it as a premature close'); // just in case things get weird
				response.close();
			} else {
				if (xhrRequest.response)
					response.write(xhrRequest.response.slice(lenOnLastPoll));
				response.end();
			}
		}
	};
});


// HTTPL
// =====
var localNotFoundServer = {
	fn: function(request, response) {
		response.writeHead(404, 'server not found');
		response.end();
	},
	context: null
};
var localRelayNotOnlineServer = {
	fn: function(request, response) {
		response.writeHead(407, 'peer relay not authenticated');
		response.end();
	},
	context: null
};
local.schemes.register('httpl', function(request, response) {
	// Find the local server
	var server = local.getServer(request.urld.authority);
	if (!server) {
		// Check if this is a peerweb URI
		var peerd = local.parsePeerDomain(request.urld.authority);
		if (peerd) {
			// See if this is a default stream miss
			if (peerd.stream === '0') {
				if (request.urld.authority.slice(-2) == ':0') {
					server = local.getServer(request.urld.authority.slice(0,-2));
				} else {
					server = local.getServer(request.urld.authority + ':0');
				}
			}
			if (!server) {
				// Not a default stream miss
				if (peerd.relay in __peer_relay_registry) {
					// Try connecting to the peer
					__peer_relay_registry[peerd.relay].connect(request.urld.authority);
					server = local.getServer(request.urld.authority);
				} else {
					// We're not connected to the relay
					server = localRelayNotOnlineServer;
				}
			}
		} else
			server = localNotFoundServer;
	}

	// Deserialize the headers
	request.deserializeHeaders();

	// Pull out and standardize the path
	request.path = request.urld.path;
	if (!request.path) request.path = '/'; // no path, give a '/'
	else request.path = request.path.replace(/(.)\/$/, '$1'); // otherwise, never end with a '/'

	// Pull out any query params in the path
	if (request.urld.query) {
		var query = local.contentTypes.deserialize('application/x-www-form-urlencoded', request.urld.query);
		if (!request.query) { request.query = {}; }
		for (var k in query) {
			request.query[k] = query[k];
		}
	}

	// Support warnings
	if (request.binary)
		console.warn('Got HTTPL request with binary=true - sorry, not currently supported', request);

	// Pass on to the server
	server.fn.call(server.context, request, response);
});


// Data
// ====
local.schemes.register('data', function(request, response) {
	var firstColonIndex = request.url.indexOf(':');
	var firstCommaIndex = request.url.indexOf(',');

	// parse parameters
	var param;
	var params = request.url.slice(firstColonIndex+1, firstCommaIndex).split(';');
	var contentType = params.shift();
	var isBase64 = false;
	while ((param = params.shift())) {
		if (param == 'base64')
			isBase64 = true;
	}

	// parse data
	var data = request.url.slice(firstCommaIndex+1);
	if (!data) data = '';
	if (isBase64) data = atob(data);
	else data = decodeURIComponent(data);

	// respond (async)
	setTimeout(function() {
		response.writeHead(200, 'ok', {'content-type': contentType});
		response.end(data);
	});
});


// Local Server Registry
// =====================
var __httpl_registry = {};
var __peer_relay_registry = {}; // populated by PeerWebRelay startListening() and stopListening()

// EXPORTED
local.addServer = function addServer(domain, server, serverContext) {
	if (__httpl_registry[domain]) throw new Error("server already registered at domain given to addServer");

	var isServerObj = (server instanceof local.Server);
	if (isServerObj) {
		serverContext = server;
		server = server.handleLocalRequest;
		serverContext.config.domain = domain;
	}

	__httpl_registry[domain] = { fn: server, context: serverContext };
};

// EXPORTED
local.removeServer = function removeServer(domain) {
	if (__httpl_registry[domain]) {
		delete __httpl_registry[domain];
	}
};

// EXPORTED
local.getServer = function getServer(domain) {
	return __httpl_registry[domain];
};

// EXPORTED
local.getServers = function getServers() {
	return __httpl_registry;
};
var webDispatchWrapper;

// dispatch()
// ==========
// EXPORTED
// HTTP request dispatcher
// - `request` param:
//   - if string, creates GET request for json
//   - if object, requires `url`, sends immediately (so you cant stream request body)
//   - if Response, leaves you to run write() and end() (so you can stream request body)
// - `request.query`: optional object, additional query params
// - `request.headers`: optional object
// - `request.body`: optional request body
// - `request.stream`: optional boolean, stream the response? If falsey, will buffer and deserialize the response
// - `request.binary`: optional boolean, receive a binary arraybuffer response? Only applies to HTTP/S
// - returns a `Promise` object
//   - on success (status code 2xx), the promise is fulfilled with a `ClientResponse` object
//   - on failure (status code 4xx,5xx), the promise is rejected with a `ClientResponse` object
//   - all protocol (status code 1xx,3xx) is handled internally
local.dispatch = function dispatch(request) {
	if (!request) { throw new Error("No request provided to dispatch()"); }
	if (typeof request == 'string')
		request = { url: request };
	if (!request.url) { throw new Error("No url on request"); }

	// If given a nav: scheme, spawn a agent to handle it
	var scheme = parseScheme(request.url);
	if (scheme == 'nav') {
		var url = request.url;
		delete request.url;
		return local.agent(url).dispatch(request);
	}

	// Prepare the request
	var body = null, shouldAutoSendRequestBody = false;
	if (!(request instanceof local.Request)) {
		body = request.body;
		request = new local.Request(request);
		shouldAutoSendRequestBody = true; // we're going to end()
	}
	Object.defineProperty(request, 'urld', { value: local.parseUri(request.url), configurable: true, enumerable: false, writable: true }); // (urld = url description)
	if (request.urld.query) {
		// Extract URL query parameters into the request's query object
		var q = local.contentTypes.deserialize('application/x-www-form-urlencoded', request.urld.query);
		for (var k in q)
			request.query[k] = q[k];
		request.urld.relative = request.urld.path + ((request.urld.anchor) ? ('#'+request.urld.anchor) : '');
		request.url = scheme+'://'+request.urld.authority+request.urld.relative;
	}
	request.serializeHeaders();

	// Setup response object
	var requestStartTime;
	var response = new local.Response();
	var response_ = local.promise();
	request.on('close', function() { response.close(); });
	response.on('headers', function() {
		response.deserializeHeaders();
		processResponseHeaders(request, response);
	});
	response.on('close', function() {
		// Track latency
		response.latency = Date.now() - requestStartTime;
		// Close the request
		request.close();
	});
	if (request.stream) {
		// streaming, fulfill on 'headers'
		response.on('headers', function(response) {
			local.fulfillResponsePromise(response_, response);
		});
	} else {
		// buffering, fulfill on 'close'
		response.on('close', function() {
			local.fulfillResponsePromise(response_, response);
		});
	}

	// Suspend events until the scheme handler gets a chance to wire up
	// (allows async to occur in the webDispatchWrapper)
	request.suspendEvents();
	response.suspendEvents();

	// Create function to be called by the dispatch wrapper
	var dispatchFn = function(request, response, schemeHandler) {
		// execute by scheme
		requestStartTime = Date.now();
		schemeHandler = schemeHandler || local.schemes.get(scheme);
		if (!schemeHandler) {
			response.writeHead(0, 'unsupported scheme "'+scheme+'"');
			response.end();
			request.resumeEvents();
			response.resumeEvents();
		} else {
			// dispatch according to scheme
			schemeHandler(request, response);
			// now that the scheme handler has wired up, the spice must flow
			request.resumeEvents();
			response.resumeEvents();
			// autosend request body if not given a local.Request `request`
			if (shouldAutoSendRequestBody) { request.end(body); }
		}
		return response_;
	};

	// Setup the arguments list for the dispatch wrapper to include any additional params passed to dispatch()
	// aka (request, response, dispatch, args...)
	// this allows apps to do something like local.dispatch(request, extraParam1, extraParam2) and have the dispatch wrapper use those params
	var args = Array.prototype.slice.call(arguments, 1);
	args.unshift(dispatchFn);
	args.unshift(response);
	args.unshift(request);

	// Wait until next tick, to make sure dispatch() is always async
	setTimeout(function() {
		// Allow the wrapper to audit the message
		webDispatchWrapper.apply(null, args);
	}, 0);

	response_.request = request;
	return response_;
};

// EXPORTED
// fulfills/reject a promise for a response with the given response
// - exported because its pretty useful
local.fulfillResponsePromise = function(promise, response) {
	// wasnt streaming, fulfill now that full response is collected
	if (response.status >= 200 && response.status < 400)
		promise.fulfill(response);
	else if (response.status >= 400 && response.status < 600 || response.status === 0)
		promise.reject(response);
	else
		promise.fulfill(response); // :TODO: 1xx protocol handling
};

local.setDispatchWrapper = function(wrapperFn) {
	webDispatchWrapper = wrapperFn;
};

local.setDispatchWrapper(function(request, response, dispatch) {
	dispatch(request, response);
});

// INTERNAL
// Makes sure response header links are absolute and extracts additional attributes
var isUrlAbsoluteRE = /(:\/\/)|(^[-A-z0-9]*\.[-A-z0-9]*)/; // has :// or starts with ___.___
function processResponseHeaders(request, response) {
	if (response.parsedHeaders.link) {
		response.parsedHeaders.link.forEach(function(link) {
			if (isUrlAbsoluteRE.test(link.href) === false)
				link.href = local.joinRelPath(request.urld, link.href);
			link.host_domain = local.parseUri(link.href).authority;
			var peerd = local.parsePeerDomain(link.host_domain);
			if (peerd) {
				link.host_user   = peerd.user;
				link.host_relay  = peerd.relay;
				link.host_app    = peerd.app;
				link.host_stream = peerd.stream;
			} else {
				delete link.host_user;
				delete link.host_relay;
				delete link.host_app;
				delete link.host_stream;
			}
		});
	}
}

// INTERNAL
function parseScheme(url) {
	var schemeMatch = /^([^.^:]*):/.exec(url);
	if (!schemeMatch) {
		// shorthand/default schemes
		if (url.indexOf('//') === 0)
			return 'http';
		else if (url.indexOf('||') === 0)
			return 'rel';
		else
			return 'httpl';
	}
	return schemeMatch[1];
}// Events
// ======

// subscribe()
// ===========
// EXPORTED
// Establishes a connection and begins an event stream
// - sends a GET request with 'text/event-stream' as the Accept header
// - `request`: request object, formed as in `dispatch()`
// - returns a `EventStream` object
local.subscribe = function subscribe(request) {
	if (typeof request == 'string')
		request = { url: request };
	request.stream = true; // stream the response
	if (!request.method) request.method = 'SUBSCRIBE';
	if (!request.headers) request.headers = { accept : 'text/event-stream' };
	if (!request.headers.accept) request.headers.accept = 'text/event-stream';

	var response_ = local.dispatch(request);
	return new EventStream(response_.request, response_);
};


// EventStream
// ===========
// EXPORTED
// wraps a response to emit the events
function EventStream(request, response_) {
	local.util.EventEmitter.call(this);
	this.request = request;
	this.response = null;
	this.response_ = null;
	this.lastEventId = -1;
	this.isConnOpen = true;

	this.connect(response_);
}
local.EventStream = EventStream;
EventStream.prototype = Object.create(local.util.EventEmitter.prototype);
EventStream.prototype.getUrl = function() { return this.request.url; };
EventStream.prototype.connect = function(response_) {
	var self = this;
	var buffer = '', eventDelimIndex;
	this.response_ = response_;
	response_.then(
		function(response) {
			self.isConnOpen = true;
			self.response = response;
			response.on('data', function(payload) {
				// Add any data we've buffered from past events
				payload = buffer + payload;
				// Step through each event, as its been given
				while ((eventDelimIndex = payload.indexOf('\r\n\r\n')) !== -1) {
					var event = payload.slice(0, eventDelimIndex);
					emitEvent.call(self, event);
					payload = payload.slice(eventDelimIndex+4);
				}
				// Hold onto any lefovers
				buffer = payload;
			});
			response.on('end', function() { self.close(); });
			response.on('close', function() { if (self.isConnOpen) { self.reconnect(); } });
			// ^ a close event should be predicated by an end(), giving us time to close ourselves
			//   if we get a close from the other side without an end message, we assume connection fault
			return response;
		},
		function(response) {
			self.response = response;
			emitError.call(self, { event: 'error', data: response });
			self.close();
			throw response;
		}
	);
};
EventStream.prototype.reconnect = function() {
	// Shut down anything old
	if (this.isConnOpen) {
		this.isConnOpen = false;
		this.request.close();
	}

	// Hold off if the app is tearing down (Firefox will succeed in the request and then hold onto the stream)
	if (local.util.isAppClosing) {
		return;
	}

	// Re-establish the connection
	this.request = new local.Request(this.request);
	if (!this.request.headers) this.request.headers = {};
	if (this.lastEventId) this.request.headers['last-event-id'] = this.lastEventId;
	this.connect(local.dispatch(this.request));
	this.request.end();
};
EventStream.prototype.close = function() {
	if (this.isConnOpen) {
		this.isConnOpen = false;
		this.request.close();
		this.emit('close');
	}
};
function emitError(e) {
	this.emit('message', e);
	this.emit('error', e);
}
function emitEvent(e) {
	e = local.contentTypes.deserialize('text/event-stream', e);
	var id = parseInt(e.id, 10);
	if (typeof id != 'undefined' && id > this.lastEventId)
		this.lastEventId = id;
	this.emit('message', e);
	this.emit(e.event, e);
}


// EventHost
// =========
// EXPORTED
// manages response streams for a server to emit events to
function EventHost() {
	this.streams = [];
}
local.EventHost = EventHost;

// listener management
EventHost.prototype.addStream = function(responseStream) {
	responseStream.broadcastStreamId = this.streams.length;
	this.streams.push(responseStream);
	var self = this;
	responseStream.on('close', function() {
		self.endStream(responseStream);
	});
	return responseStream.broadcastStreamId;
};
EventHost.prototype.endStream = function(responseStream) {
	if (typeof responseStream == 'number') {
		responseStream = this.streams[responseStream];
	}
	delete this.streams[responseStream.broadcastStreamId];
	responseStream.end();
};
EventHost.prototype.endAllStreams = function() {
	this.streams.forEach(function(rS) { rS.end(); });
	this.streams.length = 0;
};

// Sends an event to all streams
// - `opts.exclude`: optional number|Response|[number]|[Response], streams not to send to
EventHost.prototype.emit = function(eventName, data, opts) {
	if (!opts) opts = {};
	if (opts.exclude) {
		if (!Array.isArray(opts.exclude)) {
			opts.exclude = [opts.exclude];
		}
		// Convert to ids
		opts.exclude = opts.exclude.map(function(v) {
			if (v instanceof local.Response) {
				return v.broadcastStreamId;
			}
			return v;
		}, this);
	}
	this.streams.forEach(function(rS, i) {
		if (opts.exclude && opts.exclude.indexOf(i) !== -1) {
			return;
		}
		this.emitTo(rS, eventName, data);
	}, this);
};

// sends an event to the given response stream
EventHost.prototype.emitTo = function(responseStream, eventName, data) {
	if (typeof responseStream == 'number') {
		responseStream = this.streams[responseStream];
	}
	responseStream.write({ event: eventName, data: data });
};/*
 UriTemplate Copyright (c) 2012-2013 Franz Antesberger. All Rights Reserved.
 Available via the MIT license.
*/

(function (exportCallback) {
    "use strict";

var UriTemplateError = (function () {

    function UriTemplateError (options) {
        this.options = options;
    }

    UriTemplateError.prototype.toString = function () {
        if (JSON && JSON.stringify) {
            return JSON.stringify(this.options);
        }
        else {
            return this.options;
        }
    };

    return UriTemplateError;
}());

var objectHelper = (function () {
    function isArray (value) {
        return Object.prototype.toString.apply(value) === '[object Array]';
    }

    function isString (value) {
        return Object.prototype.toString.apply(value) === '[object String]';
    }

    function isNumber (value) {
        return Object.prototype.toString.apply(value) === '[object Number]';
    }

    function isBoolean (value) {
        return Object.prototype.toString.apply(value) === '[object Boolean]';
    }

    function join (arr, separator) {
        var
            result = '',
            first = true,
            index;
        for (index = 0; index < arr.length; index += 1) {
            if (first) {
                first = false;
            }
            else {
                result += separator;
            }
            result += arr[index];
        }
        return result;
    }

    function map (arr, mapper) {
        var
            result = [],
            index = 0;
        for (; index < arr.length; index += 1) {
            result.push(mapper(arr[index]));
        }
        return result;
    }

    function filter (arr, predicate) {
        var
            result = [],
            index = 0;
        for (; index < arr.length; index += 1) {
            if (predicate(arr[index])) {
                result.push(arr[index]);
            }
        }
        return result;
    }

    function deepFreezeUsingObjectFreeze (object) {
        if (typeof object !== "object" || object === null) {
            return object;
        }
        Object.freeze(object);
        var property, propertyName;
        for (propertyName in object) {
            if (object.hasOwnProperty(propertyName)) {
                property = object[propertyName];
                // be aware, arrays are 'object', too
                if (typeof property === "object") {
                    deepFreeze(property);
                }
            }
        }
        return object;
    }

    function deepFreeze (object) {
        if (typeof Object.freeze === 'function') {
            return deepFreezeUsingObjectFreeze(object);
        }
        return object;
    }


    return {
        isArray: isArray,
        isString: isString,
        isNumber: isNumber,
        isBoolean: isBoolean,
        join: join,
        map: map,
        filter: filter,
        deepFreeze: deepFreeze
    };
}());

var charHelper = (function () {

    function isAlpha (chr) {
        return (chr >= 'a' && chr <= 'z') || ((chr >= 'A' && chr <= 'Z'));
    }

    function isDigit (chr) {
        return chr >= '0' && chr <= '9';
    }

    function isHexDigit (chr) {
        return isDigit(chr) || (chr >= 'a' && chr <= 'f') || (chr >= 'A' && chr <= 'F');
    }

    return {
        isAlpha: isAlpha,
        isDigit: isDigit,
        isHexDigit: isHexDigit
    };
}());

var pctEncoder = (function () {
    var utf8 = {
        encode: function (chr) {
            // see http://ecmanaut.blogspot.de/2006/07/encoding-decoding-utf8-in-javascript.html
            return unescape(encodeURIComponent(chr));
        },
        numBytes: function (firstCharCode) {
            if (firstCharCode <= 0x7F) {
                return 1;
            }
            else if (0xC2 <= firstCharCode && firstCharCode <= 0xDF) {
                return 2;
            }
            else if (0xE0 <= firstCharCode && firstCharCode <= 0xEF) {
                return 3;
            }
            else if (0xF0 <= firstCharCode && firstCharCode <= 0xF4) {
                return 4;
            }
            // no valid first octet
            return 0;
        },
        isValidFollowingCharCode: function (charCode) {
            return 0x80 <= charCode && charCode <= 0xBF;
        }
    };

    function pad0(v) {
      if (v.length > 1) return v;
      return '0'+v;
    }

    /**
     * encodes a character, if needed or not.
     * @param chr
     * @return pct-encoded character
     */
    function encodeCharacter (chr) {
        var
            result = '',
            octets = utf8.encode(chr),
            octet,
            index;
        for (index = 0; index < octets.length; index += 1) {
            octet = octets.charCodeAt(index);
            result += '%' + pad0(octet.toString(16).toUpperCase());
        }
        return result;
    }

    /**
     * Returns, whether the given text at start is in the form 'percent hex-digit hex-digit', like '%3F'
     * @param text
     * @param start
     * @return {boolean|*|*}
     */
    function isPercentDigitDigit (text, start) {
        return text.charAt(start) === '%' && charHelper.isHexDigit(text.charAt(start + 1)) && charHelper.isHexDigit(text.charAt(start + 2));
    }

    /**
     * Parses a hex number from start with length 2.
     * @param text a string
     * @param start the start index of the 2-digit hex number
     * @return {Number}
     */
    function parseHex2 (text, start) {
        return parseInt(text.substr(start, 2), 16);
    }

    /**
     * Returns whether or not the given char sequence is a correctly pct-encoded sequence.
     * @param chr
     * @return {boolean}
     */
    function isPctEncoded (chr) {
        if (!isPercentDigitDigit(chr, 0)) {
            return false;
        }
        var firstCharCode = parseHex2(chr, 1);
        var numBytes = utf8.numBytes(firstCharCode);
        if (numBytes === 0) {
            return false;
        }
        for (var byteNumber = 1; byteNumber < numBytes; byteNumber += 1) {
            if (!isPercentDigitDigit(chr, 3*byteNumber) || !utf8.isValidFollowingCharCode(parseHex2(chr, 3*byteNumber + 1))) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reads as much as needed from the text, e.g. '%20' or '%C3%B6'. It does not decode!
     * @param text
     * @param startIndex
     * @return the character or pct-string of the text at startIndex
     */
    function pctCharAt(text, startIndex) {
        var chr = text.charAt(startIndex);
        if (!isPercentDigitDigit(text, startIndex)) {
            return chr;
        }
        var utf8CharCode = parseHex2(text, startIndex + 1);
        var numBytes = utf8.numBytes(utf8CharCode);
        if (numBytes === 0) {
            return chr;
        }
        for (var byteNumber = 1; byteNumber < numBytes; byteNumber += 1) {
            if (!isPercentDigitDigit(text, startIndex + 3 * byteNumber) || !utf8.isValidFollowingCharCode(parseHex2(text, startIndex + 3 * byteNumber + 1))) {
                return chr;
            }
        }
        return text.substr(startIndex, 3 * numBytes);
    }

    return {
        encodeCharacter: encodeCharacter,
        isPctEncoded: isPctEncoded,
        pctCharAt: pctCharAt
    };
}());

var rfcCharHelper = (function () {

    /**
     * Returns if an character is an varchar character according 2.3 of rfc 6570
     * @param chr
     * @return (Boolean)
     */
    function isVarchar (chr) {
        return charHelper.isAlpha(chr) || charHelper.isDigit(chr) || chr === '_' || pctEncoder.isPctEncoded(chr);
    }

    /**
     * Returns if chr is an unreserved character according 1.5 of rfc 6570
     * @param chr
     * @return {Boolean}
     */
    function isUnreserved (chr) {
        return charHelper.isAlpha(chr) || charHelper.isDigit(chr) || chr === '-' || chr === '.' || chr === '_' || chr === '~';
    }

    /**
     * Returns if chr is an reserved character according 1.5 of rfc 6570
     * or the percent character mentioned in 3.2.1.
     * @param chr
     * @return {Boolean}
     */
    function isReserved (chr) {
        return chr === ':' || chr === '/' || chr === '?' || chr === '#' || chr === '[' || chr === ']' || chr === '@' || chr === '!' || chr === '$' || chr === '&' || chr === '(' ||
            chr === ')' || chr === '*' || chr === '+' || chr === ',' || chr === ';' || chr === '=' || chr === "'";
    }

    return {
        isVarchar: isVarchar,
        isUnreserved: isUnreserved,
        isReserved: isReserved
    };

}());

/**
 * encoding of rfc 6570
 */
var encodingHelper = (function () {

    function encode (text, passReserved) {
        var
            result = '',
            index,
            chr = '';
        if (typeof text === "number" || typeof text === "boolean") {
            text = text.toString();
        }
        for (index = 0; index < text.length; index += chr.length) {
            chr = text.charAt(index);
            result += rfcCharHelper.isUnreserved(chr) || (passReserved && rfcCharHelper.isReserved(chr)) ? chr : pctEncoder.encodeCharacter(chr);
        }
        return result;
    }

    function encodePassReserved (text) {
        return encode(text, true);
    }

    function encodeLiteralCharacter (literal, index) {
        var chr = pctEncoder.pctCharAt(literal, index);
        if (chr.length > 1) {
            return chr;
        }
        else {
            return rfcCharHelper.isReserved(chr) || rfcCharHelper.isUnreserved(chr) ? chr : pctEncoder.encodeCharacter(chr);
        }
    }

    function encodeLiteral (literal) {
        var
            result = '',
            index,
            chr = '';
        for (index = 0; index < literal.length; index += chr.length) {
            chr = pctEncoder.pctCharAt(literal, index);
            if (chr.length > 1) {
                result += chr;
            }
            else {
                result += rfcCharHelper.isReserved(chr) || rfcCharHelper.isUnreserved(chr) ? chr : pctEncoder.encodeCharacter(chr);
            }
        }
        return result;
    }

    return {
        encode: encode,
        encodePassReserved: encodePassReserved,
        encodeLiteral: encodeLiteral,
        encodeLiteralCharacter: encodeLiteralCharacter
    };

}());


// the operators defined by rfc 6570
var operators = (function () {

    var
        bySymbol = {};

    function create (symbol) {
        bySymbol[symbol] = {
            symbol: symbol,
            separator: (symbol === '?') ? '&' : (symbol === '' || symbol === '+' || symbol === '#') ? ',' : symbol,
            named: symbol === ';' || symbol === '&' || symbol === '?',
            ifEmpty: (symbol === '&' || symbol === '?') ? '=' : '',
            first: (symbol === '+' ) ? '' : symbol,
            encode: (symbol === '+' || symbol === '#') ? encodingHelper.encodePassReserved : encodingHelper.encode,
            toString: function () {
                return this.symbol;
            }
        };
    }

    create('');
    create('+');
    create('#');
    create('.');
    create('/');
    create(';');
    create('?');
    create('&');
    return {
        valueOf: function (chr) {
            if (bySymbol[chr]) {
                return bySymbol[chr];
            }
            if ("=,!@|".indexOf(chr) >= 0) {
                return null;
            }
            return bySymbol[''];
        }
    };
}());


/**
 * Detects, whether a given element is defined in the sense of rfc 6570
 * Section 2.3 of the RFC makes clear defintions:
 * * undefined and null are not defined.
 * * the empty string is defined
 * * an array ("list") is defined, if it is not empty (even if all elements are not defined)
 * * an object ("map") is defined, if it contains at least one property with defined value
 * @param object
 * @return {Boolean}
 */
function isDefined (object) {
    var
        propertyName;
    if (object === null || object === undefined) {
        return false;
    }
    if (objectHelper.isArray(object)) {
        // Section 2.3: A variable defined as a list value is considered undefined if the list contains zero members
        return object.length > 0;
    }
    if (typeof object === "string" || typeof object === "number" || typeof object === "boolean") {
        // falsy values like empty strings, false or 0 are "defined"
        return true;
    }
    // else Object
    for (propertyName in object) {
        if (object.hasOwnProperty(propertyName) && isDefined(object[propertyName])) {
            return true;
        }
    }
    return false;
}

var LiteralExpression = (function () {
    function LiteralExpression (literal) {
        this.literal = encodingHelper.encodeLiteral(literal);
    }

    LiteralExpression.prototype.expand = function () {
        return this.literal;
    };

    LiteralExpression.prototype.toString = LiteralExpression.prototype.expand;

    return LiteralExpression;
}());

var parse = (function () {

    function parseExpression (expressionText) {
        var
            operator,
            varspecs = [],
            varspec = null,
            varnameStart = null,
            maxLengthStart = null,
            index,
            chr = '';

        function closeVarname () {
            var varname = expressionText.substring(varnameStart, index);
            if (varname.length === 0) {
                throw new UriTemplateError({expressionText: expressionText, message: "a varname must be specified", position: index});
            }
            varspec = {varname: varname, exploded: false, maxLength: null};
            varnameStart = null;
        }

        function closeMaxLength () {
            if (maxLengthStart === index) {
                throw new UriTemplateError({expressionText: expressionText, message: "after a ':' you have to specify the length", position: index});
            }
            varspec.maxLength = parseInt(expressionText.substring(maxLengthStart, index), 10);
            maxLengthStart = null;
        }

        operator = (function (operatorText) {
            var op = operators.valueOf(operatorText);
            if (op === null) {
                throw new UriTemplateError({expressionText: expressionText, message: "illegal use of reserved operator", position: index, operator: operatorText});
            }
            return op;
        }(expressionText.charAt(0)));
        index = operator.symbol.length;

        varnameStart = index;

        for (; index < expressionText.length; index += chr.length) {
            chr = pctEncoder.pctCharAt(expressionText, index);

            if (varnameStart !== null) {
                // the spec says: varname =  varchar *( ["."] varchar )
                // so a dot is allowed except for the first char
                if (chr === '.') {
                    if (varnameStart === index) {
                        throw new UriTemplateError({expressionText: expressionText, message: "a varname MUST NOT start with a dot", position: index});
                    }
                    continue;
                }
                if (rfcCharHelper.isVarchar(chr)) {
                    continue;
                }
                closeVarname();
            }
            if (maxLengthStart !== null) {
                if (index === maxLengthStart && chr === '0') {
                    throw new UriTemplateError({expressionText: expressionText, message: "A :prefix must not start with digit 0", position: index});
                }
                if (charHelper.isDigit(chr)) {
                    if (index - maxLengthStart >= 4) {
                        throw new UriTemplateError({expressionText: expressionText, message: "A :prefix must have max 4 digits", position: index});
                    }
                    continue;
                }
                closeMaxLength();
            }
            if (chr === ':') {
                if (varspec.maxLength !== null) {
                    throw new UriTemplateError({expressionText: expressionText, message: "only one :maxLength is allowed per varspec", position: index});
                }
                if (varspec.exploded) {
                    throw new UriTemplateError({expressionText: expressionText, message: "an exploeded varspec MUST NOT be varspeced", position: index});
                }
                maxLengthStart = index + 1;
                continue;
            }
            if (chr === '*') {
                if (varspec === null) {
                    throw new UriTemplateError({expressionText: expressionText, message: "exploded without varspec", position: index});
                }
                if (varspec.exploded) {
                    throw new UriTemplateError({expressionText: expressionText, message: "exploded twice", position: index});
                }
                if (varspec.maxLength) {
                    throw new UriTemplateError({expressionText: expressionText, message: "an explode (*) MUST NOT follow to a prefix", position: index});
                }
                varspec.exploded = true;
                continue;
            }
            // the only legal character now is the comma
            if (chr === ',') {
                varspecs.push(varspec);
                varspec = null;
                varnameStart = index + 1;
                continue;
            }
            throw new UriTemplateError({expressionText: expressionText, message: "illegal character", character: chr, position: index});
        } // for chr
        if (varnameStart !== null) {
            closeVarname();
        }
        if (maxLengthStart !== null) {
            closeMaxLength();
        }
        varspecs.push(varspec);
        return new VariableExpression(expressionText, operator, varspecs);
    }

    function parse (uriTemplateText) {
        // assert filled string
        var
            index,
            chr,
            expressions = [],
            braceOpenIndex = null,
            literalStart = 0;
        for (index = 0; index < uriTemplateText.length; index += 1) {
            chr = uriTemplateText.charAt(index);
            if (literalStart !== null) {
                if (chr === '}') {
                    throw new UriTemplateError({templateText: uriTemplateText, message: "unopened brace closed", position: index});
                }
                if (chr === '{') {
                    if (literalStart < index) {
                        expressions.push(new LiteralExpression(uriTemplateText.substring(literalStart, index)));
                    }
                    literalStart = null;
                    braceOpenIndex = index;
                }
                continue;
            }

            if (braceOpenIndex !== null) {
                // here just { is forbidden
                if (chr === '{') {
                    throw new UriTemplateError({templateText: uriTemplateText, message: "brace already opened", position: index});
                }
                if (chr === '}') {
                    if (braceOpenIndex + 1 === index) {
                        throw new UriTemplateError({templateText: uriTemplateText, message: "empty braces", position: braceOpenIndex});
                    }
                    try {
                        expressions.push(parseExpression(uriTemplateText.substring(braceOpenIndex + 1, index)));
                    }
                    catch (error) {
                        if (error.prototype === UriTemplateError.prototype) {
                            throw new UriTemplateError({templateText: uriTemplateText, message: error.options.message, position: braceOpenIndex + error.options.position, details: error.options});
                        }
                        throw error;
                    }
                    braceOpenIndex = null;
                    literalStart = index + 1;
                }
                continue;
            }
            throw new Error('reached unreachable code');
        }
        if (braceOpenIndex !== null) {
            throw new UriTemplateError({templateText: uriTemplateText, message: "unclosed brace", position: braceOpenIndex});
        }
        if (literalStart < uriTemplateText.length) {
            expressions.push(new LiteralExpression(uriTemplateText.substr(literalStart)));
        }
        return new UriTemplate(uriTemplateText, expressions);
    }

    return parse;
}());

var VariableExpression = (function () {
    // helper function if JSON is not available
    function prettyPrint (value) {
        return (JSON && JSON.stringify) ? JSON.stringify(value) : value;
    }

    function isEmpty (value) {
        if (!isDefined(value)) {
            return true;
        }
        if (objectHelper.isString(value)) {
            return value === '';
        }
        if (objectHelper.isNumber(value) || objectHelper.isBoolean(value)) {
            return false;
        }
        if (objectHelper.isArray(value)) {
            return value.length === 0;
        }
        for (var propertyName in value) {
            if (value.hasOwnProperty(propertyName)) {
                return false;
            }
        }
        return true;
    }

    function propertyArray (object) {
        var
            result = [],
            propertyName;
        for (propertyName in object) {
            if (object.hasOwnProperty(propertyName)) {
                result.push({name: propertyName, value: object[propertyName]});
            }
        }
        return result;
    }

    function VariableExpression (templateText, operator, varspecs) {
        this.templateText = templateText;
        this.operator = operator;
        this.varspecs = varspecs;
    }

    VariableExpression.prototype.toString = function () {
        return this.templateText;
    };

    function expandSimpleValue(varspec, operator, value) {
        var result = '';
        value = value.toString();
        if (operator.named) {
            result += encodingHelper.encodeLiteral(varspec.varname);
            if (value === '') {
                result += operator.ifEmpty;
                return result;
            }
            result += '=';
        }
        if (varspec.maxLength !== null) {
            value = value.substr(0, varspec.maxLength);
        }
        result += operator.encode(value);
        return result;
    }

    function valueDefined (nameValue) {
        return isDefined(nameValue.value);
    }

    function expandNotExploded(varspec, operator, value) {
        var
            arr = [],
            result = '';
        if (operator.named) {
            result += encodingHelper.encodeLiteral(varspec.varname);
            if (isEmpty(value)) {
                result += operator.ifEmpty;
                return result;
            }
            result += '=';
        }
        if (objectHelper.isArray(value)) {
            arr = value;
            arr = objectHelper.filter(arr, isDefined);
            arr = objectHelper.map(arr, operator.encode);
            result += objectHelper.join(arr, ',');
        }
        else {
            arr = propertyArray(value);
            arr = objectHelper.filter(arr, valueDefined);
            arr = objectHelper.map(arr, function (nameValue) {
                return operator.encode(nameValue.name) + ',' + operator.encode(nameValue.value);
            });
            result += objectHelper.join(arr, ',');
        }
        return result;
    }

    function expandExplodedNamed (varspec, operator, value) {
        var
            isArray = objectHelper.isArray(value),
            arr = [];
        if (isArray) {
            arr = value;
            arr = objectHelper.filter(arr, isDefined);
            arr = objectHelper.map(arr, function (listElement) {
                var tmp = encodingHelper.encodeLiteral(varspec.varname);
                if (isEmpty(listElement)) {
                    tmp += operator.ifEmpty;
                }
                else {
                    tmp += '=' + operator.encode(listElement);
                }
                return tmp;
            });
        }
        else {
            arr = propertyArray(value);
            arr = objectHelper.filter(arr, valueDefined);
            arr = objectHelper.map(arr, function (nameValue) {
                var tmp = encodingHelper.encodeLiteral(nameValue.name);
                if (isEmpty(nameValue.value)) {
                    tmp += operator.ifEmpty;
                }
                else {
                    tmp += '=' + operator.encode(nameValue.value);
                }
                return tmp;
            });
        }
        return objectHelper.join(arr, operator.separator);
    }

    function expandExplodedUnnamed (operator, value) {
        var
            arr = [],
            result = '';
        if (objectHelper.isArray(value)) {
            arr = value;
            arr = objectHelper.filter(arr, isDefined);
            arr = objectHelper.map(arr, operator.encode);
            result += objectHelper.join(arr, operator.separator);
        }
        else {
            arr = propertyArray(value);
            arr = objectHelper.filter(arr, function (nameValue) {
                return isDefined(nameValue.value);
            });
            arr = objectHelper.map(arr, function (nameValue) {
                return operator.encode(nameValue.name) + '=' + operator.encode(nameValue.value);
            });
            result += objectHelper.join(arr, operator.separator);
        }
        return result;
    }


    VariableExpression.prototype.expand = function (variables) {
        var
            expanded = [],
            index,
            varspec,
            value,
            valueIsArr,
            oneExploded = false,
            operator = this.operator;

        // expand each varspec and join with operator's separator
        for (index = 0; index < this.varspecs.length; index += 1) {
            varspec = this.varspecs[index];
            value = variables[varspec.varname];
            // if (!isDefined(value)) {
            // if (variables.hasOwnProperty(varspec.name)) {
            if (value === null || value === undefined) {
                continue;
            }
            if (varspec.exploded) {
                oneExploded = true;
            }
            valueIsArr = objectHelper.isArray(value);
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                expanded.push(expandSimpleValue(varspec, operator, value));
            }
            else if (varspec.maxLength && isDefined(value)) {
                // 2.4.1 of the spec says: "Prefix modifiers are not applicable to variables that have composite values."
                throw new Error('Prefix modifiers are not applicable to variables that have composite values. You tried to expand ' + this + " with " + prettyPrint(value));
            }
            else if (!varspec.exploded) {
                if (operator.named || !isEmpty(value)) {
                    expanded.push(expandNotExploded(varspec, operator, value));
                }
            }
            else if (isDefined(value)) {
                if (operator.named) {
                    expanded.push(expandExplodedNamed(varspec, operator, value));
                }
                else {
                    expanded.push(expandExplodedUnnamed(operator, value));
                }
            }
        }

        if (expanded.length === 0) {
            return "";
        }
        else {
            return operator.first + objectHelper.join(expanded, operator.separator);
        }
    };

    return VariableExpression;
}());

var UriTemplate = (function () {
    function UriTemplate (templateText, expressions) {
        this.templateText = templateText;
        this.expressions = expressions;
        objectHelper.deepFreeze(this);
    }

    UriTemplate.prototype.toString = function () {
        return this.templateText;
    };

    UriTemplate.prototype.expand = function (variables) {
        // this.expressions.map(function (expression) {return expression.expand(variables);}).join('');
        var
            index,
            result = '';
        for (index = 0; index < this.expressions.length; index += 1) {
            result += this.expressions[index].expand(variables);
        }
        return result;
    };

    UriTemplate.parse = parse;
    UriTemplate.UriTemplateError = UriTemplateError;
    return UriTemplate;
}());

    exportCallback(UriTemplate);

}(function (UriTemplate) {
        "use strict";
        local.UriTemplate = UriTemplate;
}));// Agent
// =====

function getEnvironmentHost() {
	if (typeof window !== 'undefined') return window.location.host;
	if (app) return app.config.environmentHost; // must be passed to in the ready config
	return '';
}

// AgentContext
// ============
// INTERNAL
// information about the resource that a agent targets
//  - exists in an "unresolved" state until the URI is confirmed by a response from the server
//  - enters a "bad" state if an attempt to resolve the link failed
//  - may be "relative" if described by a relation from another context (eg a query or a relative URI)
//  - may be "absolute" if described by an absolute URI
// :NOTE: absolute contexts may have a URI without being resolved, so don't take the presence of a URI as a sign that the resource exists
function AgentContext(query) {
	this.query = query;
	this.resolveState = AgentContext.UNRESOLVED;
	this.error = null;
	this.queryIsAbsolute = (typeof query == 'string' && local.isAbsUri(query));
	if (this.queryIsAbsolute) {
		this.url  = query;
		this.urld = local.parseUri(this.url);
	} else {
		this.url = null;
		this.urld = null;
	}
}
AgentContext.UNRESOLVED = 0;
AgentContext.RESOLVED   = 1;
AgentContext.FAILED     = 2;
AgentContext.prototype.isResolved = function() { return this.resolveState === AgentContext.RESOLVED; };
AgentContext.prototype.isBad      = function() { return this.resolveState === AgentContext.FAILED; };
AgentContext.prototype.isRelative = function() { return (!this.queryIsAbsolute); };
AgentContext.prototype.isAbsolute = function() { return this.queryIsAbsolute; };
AgentContext.prototype.getUrl     = function() { return this.url; };
AgentContext.prototype.getError   = function() { return this.error; };
AgentContext.prototype.resetResolvedState = function() {
	this.resolveState = AgentContext.UNRESOLVED;
	this.error = null;
};
AgentContext.prototype.setResolved = function(url) {
	this.error        = null;
	this.resolveState = AgentContext.RESOLVED;
	if (url) {
		this.url          = url;
		this.urld         = local.parseUri(this.url);
	}
};
AgentContext.prototype.setFailed = function(error) {
	this.error        = error;
	this.resolveState = AgentContext.FAILED;
};

// Agent
// =========
// EXPORTED
// API to follow resource links (as specified by the response Link header)
//  - uses the rel attribute as the primary link label
//  - uses URI templates to generate URIs
//  - queues link navigations until a request is made
/*

// EXAMPLE 1. Get Bob from Foobar.com
// - basic navigation
// - requests
var foobarService = local.agent('https://foobar.com');
var bob = foobarService.follow('|collection=users|item=bob');
// ^ or local.agent('nav:||https://foobar.com|collection=users|item=bob')
// ^ or foobarService.follow([{ rel: 'collection', id: 'users' }, { rel: 'item', id:'bob' }]);
// ^ or foobarService.follow({ rel: 'collection', id: 'users' }).follow({ rel: 'item', id:'bob' });
bob.get()
	// -> HEAD https://foobar.com
	// -> HEAD https://foobar.com/users
	// -> GET  https://foobar.com/users/bob (Accept: application/json)
	.then(function(response) {
		var bobsProfile = response.body;

		// Update Bob's email
		bobsProfile.email = 'bob@gmail.com';
		bob.put(bobsProfile);
		// -> PUT https://foobar.com/users/bob { email:'bob@gmail.com', ...} (Content-Type: application/json)
	});

// EXAMPLE 2. Get all users who joined after 2013, in pages of 150
// - additional navigation query parameters
// - server-driven batching
var pageCursor = foobarService.follow('|collection=users,since=2013-01-01,limit=150');
pageCursor.get()
	// -> GET https://foobar.com/users?since=2013-01-01&limit=150 (Accept: application/json)
	.then(function readNextPage(response) {
		// Send the emails
		emailNewbieGreetings(response.body); // -- emailNewbieGreetings is a fake utility function

		// Go to the 'next page' link, as supplied by the response
		pageCursor = pageCursor.follow('|next');
		return pageCursor.get().then(readNextPage);
		// -> GET https://foobar.com/users?since=2013-01-01&limit=150&offset=150 (Accept: application/json)
	})
	.fail(function(response, request) {
		// Not finding a 'rel=next' link means the server didn't give us one.
		if (response.status == local.LINK_NOT_FOUND) { // 001 Local: Link not found - termination condition
			// Tell Bob his greeting was sent
			bob.follow('|grimwire.com/-mail/inbox').post({
				title: '2013 Welcome Emails Sent',
				body: 'Good work, Bob.'
			});
			// -> POST https://foobar.com/mail/users/bob/inbox (Content-Type: application/json)
		} else {
			// Tell Bob something went wrong
			bob.follow('|grimwire.com/-mail/inbox').post({
				title: 'ERROR! 2013 Welcome Emails Failed!',
				body: 'Way to blow it, Bob.',
				attachments: {
					'dump.json': {
						context: pageCursor.getContext(),
						request: request,
						response: response
					}
				}
			});
			// -> POST https://foobar.com/mail/users/bob/inbox (Content-Type: application/json)
		}
	});
*/
function Agent(context, parentAgent) {
	this.context         = context         || null;
	this.parentAgent = parentAgent || null;
	this.links           = null;
	this.requestDefaults = null;
}
local.Agent = Agent;

// Sets defaults to be used in all requests
// - eg nav.setRequestDefaults({ method: 'GET', headers: { authorization: 'bob:pass', accept: 'text/html' }})
// - eg nav.setRequestDefaults({ proxy: 'httpl://myproxy.app' })
Agent.prototype.setRequestDefaults = function(v) {
	this.requestDefaults = v;
};

// Helper to copy over request defaults
function copyDefaults(target, defaults) {
	for (var k in defaults) {
		if (k == 'headers' || !!target[k])
			continue;
		// ^ headers should be copied per-attribute
		if (typeof defaults[k] == 'object')
			target[k] = local.util.deepClone(defaults[k]);
		else
			target[k] = defaults[k];
	}
	if (defaults.headers) {
		if (!target.headers)
			target.headers = {};
		copyDefaults(target.headers, defaults.headers);
	}
}

// Executes an HTTP request to our context
//  - uses additional parameters on the request options:
//    - noretry: bool, should the url resolve fail automatically if it previously failed?
Agent.prototype.dispatch = function(req) {
	if (!req) req = {};
	if (!req.headers) req.headers = {};
	var self = this;

	if (this.requestDefaults)
		copyDefaults(req, this.requestDefaults);

	// Resolve our target URL
	return ((req.url) ? local.promise(req.url) : this.resolve({ noretry: req.noretry, nohead: true }))
		.succeed(function(url) {
			req.url = url;
			return local.dispatch(req);
		})
		.succeed(function(res) {
			// After every successful request, update our links and mark our context as good (in case it had been bad)
			self.context.setResolved();
			if (res.parsedHeaders.link) self.links = res.parsedHeaders.link;
			else self.links = self.links || []; // cache an empty link list so we dont keep trying during resolution
			return res;
		})
		.fail(function(res) {
			// Let a 1 or 404 indicate a bad context (as opposed to some non-navigational error like a bad request body)
			if (res.status === local.LINK_NOT_FOUND || res.status === 404)
				self.context.setFailed(res);
			throw res;
		});
};

// Executes a GET text/event-stream request to our context
Agent.prototype.subscribe = function(req) {
	var self = this;
	if (!req) req = {};
	return this.resolve({ nohead: true }).succeed(function(url) {
		req.url = url;

		if (self.requestDefaults)
			copyDefaults(req, self.requestDefaults);

		return local.subscribe(req);
	});
};

// Follows a link relation from our context, generating a new agent
// - `query` may be:
//   - an object in the same form of a `local.queryLink()` parameter
//   - an array of link query objects (to be followed sequentially)
//   - a URI string
//     - if using the 'nav:' scheme, will convert the URI into a link query object
//     - if a relative URI using the HTTP/S/L scheme, will follow the relation relative to the current context
//     - if an absolute URI using the HTTP/S/L scheme, will go to that URI
// - uses URI Templates to generate URLs
// - when querying, only the `rel` and `id` (if specified) attributes must match
//   - the exception to this is: `rel` matches and the HREF has an {id} token
//   - all other attributes are used to fill URI Template tokens and are not required to match
Agent.prototype.follow = function(query) {
	// convert nav: uri to a query array
	if (typeof query == 'string' && local.isNavSchemeUri(query))
		query = local.parseNavUri(query);

	// make sure we always have an array
	if (!Array.isArray(query))
		query = [query];

	// build a full follow() chain
	var nav = this;
	do {
		nav = new Agent(new AgentContext(query.shift()), nav);
		if (this.requestDefaults)
			nav.setRequestDefaults(this.requestDefaults);
	} while (query[0]);

	return nav;
};

// Resets the agent's resolution state, causing it to reissue HEAD requests (relative to any parent agents)
Agent.prototype.unresolve = function() {
	this.context.resetResolvedState();
	this.links = null;
	return this;
};

// Reassigns the agent to a new absolute URL
// - `url`: required string, the URL to rebase the agent to
// - resets the resolved state
Agent.prototype.rebase = function(url) {
	this.unresolve();
	this.context.query = url;
	this.context.queryIsAbsolute = true;
	this.context.url  = url;
	this.context.urld = local.parseUri(url);
	return this;
};

// Resolves the agent's URL, reporting failure if a link or resource is unfound
//  - also ensures the links have been retrieved from the context
//  - may trigger resolution of parent contexts
//  - options is optional and may include:
//    - noretry: bool, should the url resolve fail automatically if it previously failed?
//    - nohead: bool, should we issue a HEAD request once we have a URL? (not favorable if planning to dispatch something else)
//  - returns a promise which will fulfill with the resolved url
Agent.prototype.resolve = function(options) {
	var self = this;
	options = options || {};

	var nohead = options.nohead;
	delete options.nohead;
	// ^ pull `nohead` out so that parent resolves are `nohead: false` - we do want them to dispatch HEAD requests to resolve us

	var resolvePromise = local.promise();
	if (this.links !== null && (this.context.isResolved() || (this.context.isAbsolute() && this.context.isBad() === false))) {
		// We have links and we were previously resolved (or we're absolute so there's no need)
		resolvePromise.fulfill(this.context.getUrl());
	} else if (this.context.isBad() === false || (this.context.isBad() && !options.noretry)) {
		// We don't have links, and we haven't previously failed (or we want to try again)
		this.context.resetResolvedState();

		if (this.context.isRelative() && !this.parentAgent) {
			// Scheme-less URIs can map to local URIs, so make sure the local server hasnt been added since we were created
			if (typeof this.context.query == 'string' && !!local.getServer(this.context.query)) {
				self.context = new AgentContext(self.context.query);
			} else {
				self.context.setFailed({ status: 404, reason: 'not found' });
				resolvePromise.reject(this.context.getError());
				return resolvePromise;
			}
		}

		if (this.context.isRelative()) {
			// Up the chain we go
			resolvePromise = this.parentAgent.resolve(options)
				.succeed(function() {
					// Parent resolved, query its links
					var childUrl = self.parentAgent.lookupLink(self.context);
					if (childUrl) {
						// We have a pope! I mean, link.
						self.context.setResolved(childUrl);

						// Send a HEAD request to get our links
						if (nohead) // unless dont
							return childUrl;
						return self.dispatch({ method: 'HEAD', url: childUrl })
							.succeed(function() { return childUrl; }); // fulfill resolvePromise afterward
					}

					// Error - Link not found
					var response = new local.Response();
					response.writeHead(local.LINK_NOT_FOUND, 'link query failed to match').end();
					throw response;
				})
				.fail(function(error) {
					self.context.setFailed(error);
					throw error;
				});
		} else {
			// At the top of the chain already
			if (nohead)
				resolvePromise.fulfill(self.context.getUrl());
			else {
				resolvePromise = this.dispatch({ method: 'HEAD', url: self.context.getUrl() })
					.succeed(function(res) { return self.context.getUrl(); });
			}
		}
	} else {
		// We failed in the past and we don't want to try again
		resolvePromise.reject(this.context.getError());
	}
	return resolvePromise;
};

// Looks up a link in the cache and generates the URI (the follow logic)
Agent.prototype.lookupLink = function(context) {
	if (context.query) {
		if (typeof context.query == 'object') {
			// Try to find a link that matches
			var link = local.queryLinks(this.links, context.query)[0];
			if (link)
				return local.UriTemplate.parse(link.href).expand(context.query);
		}
		else if (typeof context.query == 'string') {
			// A URL
			if (!local.isAbsUri(context.query))
				return local.joinRelPath(this.context.urld, context.query);
			return context.query;
		}
	}
	console.log('Failed to find a link to resolve context. Link query:', context.query, 'Agent:', this);
	return null;
};

// Dispatch Sugars
// ===============
function makeDispSugar(method) {
	return function(headers, options) {
		var req = options || {};
		req.headers = headers || {};
		req.method = method;
		return this.dispatch(req);
	};
}
function makeDispWBodySugar(method) {
	return function(body, headers, options) {
		var req = options || {};
		req.headers = headers || {};
		req.method = method;
		req.body = body;
		return this.dispatch(req);
	};
}
Agent.prototype.head   = makeDispSugar('HEAD');
Agent.prototype.get    = makeDispSugar('GET');
Agent.prototype.delete = makeDispSugar('DELETE');
Agent.prototype.post   = makeDispWBodySugar('POST');
Agent.prototype.put    = makeDispWBodySugar('PUT');
Agent.prototype.patch  = makeDispWBodySugar('PATCH');
Agent.prototype.notify = makeDispWBodySugar('NOTIFY');

// Builder
// =======
local.agent = function(query) {
	if (query instanceof Agent)
		return query;

	// convert nav: uri to a query array
	if (typeof query == 'string' && local.isNavSchemeUri(query))
		query = local.parseNavUri(query);

	// make sure we always have an array
	if (!Array.isArray(query))
		query = [query];

	// build a full follow() chain
	var nav = new Agent(new AgentContext(query.shift()));
	while (query[0]) {
		nav = new Agent(new AgentContext(query.shift()), nav);
	}

	return nav;
};// Local Registry Host
local.addServer('hosts', function(req, res) {
	var localHosts = local.getServers();

	if (!(req.method == 'HEAD' || req.method == 'GET'))
		return res.writeHead(405, 'bad method').end();

	if (req.method == 'GET' && !local.preferredType(req, 'application/json'))
		return res.writeHead(406, 'bad accept - only provides application/json').end();

	var responses_ = [];
	var domains = [], links = [];
	links.push({ href: '/', rel: 'self service via', id: 'hosts' });
	for (var domain in localHosts) {
		if (domain == 'hosts')
			continue;
		domains.push(domain);
		responses_.push(local.dispatch({ method: 'HEAD', url: 'httpl://'+domain }));
	}

	local.promise.bundle(responses_).then(function(ress) {
		ress.forEach(function(res, i) {
			var selfLink = local.queryLinks(res, { rel: 'self' })[0];
			if (!selfLink) {
				selfLink = { rel: 'service', id: domains[i], href: 'httpl://'+domains[i] };
			}
			selfLink.rel = (selfLink.rel) ? selfLink.rel.replace(/(^|\s)self(\s|$)/i, '') : 'service';
			links.push(selfLink);
		});

		res.setHeader('link', links);
		if (req.method == 'HEAD')
			return res.writeHead(204, 'ok, no content').end();
		res.writeHead(200, 'ok', { 'content-type': 'application/json' });
		res.end({ host_names: domains });
	});
});})();// Local Worker Tools
// ==================
// pfraze 2013

if (typeof self.window == 'undefined') {

	if (typeof this.local.worker == 'undefined')
		this.local.worker = {};

	(function() {(function() {

	// PageServer
	// ==========
	// EXPORTED
	// wraps the comm interface to a page for messaging
	// - `id`: required number, should be the index of the connection in the list
	// - `port`: required object, either `self` (for non-shared workers) or a port from `onconnect`
	// - `isHost`: boolean, should connection get host privileges?
	function PageServer(id, port, isHost) {
		local.BridgeServer.call(this);
		this.id = id;
		this.port = port;
		this.isHostPage = isHost;

		// Setup the incoming message handler
		this.port.addEventListener('message', (function(event) {
			var message = event.data;
			if (!message)
				return console.error('Invalid message from page: Payload missing', event);

			// Handle messages with an `op` field as worker-control packets rather than HTTPL messages
			switch (message.op) {
				case 'configure':
					this.onPageConfigure(message.body);
					break;
				case 'terminate':
					this.terminate();
					break;
				default:
					// If no recognized 'op' field is given, treat it as an HTTPL request and pass onto our BridgeServer parent method
					this.onChannelMessage(message);
					break;
			}
		}).bind(this));
	}
	PageServer.prototype = Object.create(local.BridgeServer.prototype);
	local.worker.PageServer = PageServer;

	// Returns true if the channel is ready for activity
	// - returns boolean
	PageServer.prototype.isChannelActive = function() {
		return true;
	};

	// Sends a single message across the channel
	// - `msg`: required string
	PageServer.prototype.channelSendMsg = function(msg) {
		this.port.postMessage(msg);
	};

	// Remote request handler
	PageServer.prototype.handleRemoteRequest = function(request, response) {
		var server = local.worker.serverFn;
		if (server && typeof server == 'function') {
			server.call(this, request, response, this);
		} else if (server && server.handleRemoteRequest) {
			server.handleRemoteRequest(request, response, this);
		} else {
			response.writeHead(500, 'not implemented');
			response.end();
		}
	};

	// Stores configuration sent by the page
	PageServer.prototype.onPageConfigure = function(message) {
		if (!this.isHostPage) {
			console.log('rejected "configure" from non-host connection');
			return;
		}
		local.worker.config = message;
	};

})();// Setup
// =====
local.util.mixinEventEmitter(local.worker);

// EXPORTED
// console.* replacements
self.console = {
	log: function() {
		var args = Array.prototype.slice.call(arguments);
		doLog('log', args);
	},
	dir: function() {
		var args = Array.prototype.slice.call(arguments);
		doLog('dir', args);
	},
	debug: function() {
		var args = Array.prototype.slice.call(arguments);
		doLog('debug', args);
	},
	warn: function() {
		var args = Array.prototype.slice.call(arguments);
		doLog('warn', args);
	},
	error: function() {
		var args = Array.prototype.slice.call(arguments);
		doLog('error', args);
	}
};
function doLog(type, args) {
	var hostPage = local.worker.hostPage;
	try { hostPage.channelSendMsg({ op: 'log', body: [type].concat(args) }); }
	catch (e) {
		// this is usually caused by trying to log information that cant be serialized
		hostPage.channelSendMsg({ op: 'log', body: [type].concat(args.map(JSONifyMessage)) });
	}
}

// INTERNAL
// helper to try to get a failed log message through
function JSONifyMessage(data) {
	if (Array.isArray(data))
		return data.map(JSONifyMessage);
	if (data && typeof data == 'object')
		return JSON.stringify(data);
	return data;
}

// EXPORTED
// btoa shim
// - from https://github.com/lydonchandra/base64encoder
//   (thanks to Lydon Chandra)
if (!self.btoa) {
	var PADCHAR = '=';
	var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	function getbyte(s,i) {
		var x = s.charCodeAt(i) & 0xFF;
		return x;
	}
	self.btoa = function(s) {
		var padchar = PADCHAR;
		var alpha   = ALPHA;

		var i, b10;
		var x = [];

		// convert to string
		s = '' + s;

		var imax = s.length - s.length % 3;

		if (s.length === 0) {
			return s;
		}
		for (i = 0; i < imax; i += 3) {
			b10 = (getbyte(s,i) << 16) | (getbyte(s,i+1) << 8) | getbyte(s,i+2);
			x.push(alpha.charAt(b10 >> 18));
			x.push(alpha.charAt((b10 >> 12) & 0x3F));
			x.push(alpha.charAt((b10 >> 6) & 0x3f));
			x.push(alpha.charAt(b10 & 0x3f));
		}
		switch (s.length - imax) {
		case 1:
			b10 = getbyte(s,i) << 16;
			x.push(alpha.charAt(b10 >> 18) + alpha.charAt((b10 >> 12) & 0x3F) + padchar + padchar);
			break;
		case 2:
			b10 = (getbyte(s,i) << 16) | (getbyte(s,i+1) << 8);
			x.push(alpha.charAt(b10 >> 18) + alpha.charAt((b10 >> 12) & 0x3F) +
				   alpha.charAt((b10 >> 6) & 0x3f) + padchar);
			break;
		}
		return x.join('');
	};
}

local.worker.setServer = function(fn) {
	local.worker.serverFn = fn;
};

local.worker.pages = [];
function addConnection(port) {
	// Create new page server
	var isHost = (!local.worker.hostPage); // First to add = host page
	var page = new local.worker.PageServer(local.worker.pages.length, port, isHost);

	// Track new connection
	if (isHost) {
		local.worker.hostPage = page;
	}
	local.worker.pages.push(page);
	local.addServer(page.id+'.page', page);

	// Let the document know we're active
	if (port.start) {
		port.start();
	}
	page.channelSendMsg({ op: 'ready', body: { hostPrivileges: isHost } });

	// Fire event
	local.worker.emit('connect', page);
}

// Setup for future connections (shared worker)
addEventListener('connect', function(e) {
	addConnection(e.ports[0]);
});
// Create connection to host page (regular worker)
if (self.postMessage) {
	addConnection(self);
}})();

}if (typeof this.local == 'undefined')
	this.local = {};

(function() {local.logAllExceptions = false;// Helpers to create servers
// -

// EXPORTED
// Creates a Web Worker and a bridge server to the worker
// eg `local.spawnWorkerServer('http://foo.com/myworker.js', localServerFn, )
// - `src`: required string, the URI to load into the worker
// - `config`: optional object, additional config options to pass to the worker
// - `config.domain`: optional string, overrides the automatic domain generation
// - `config.shared`: boolean, should the workerserver be shared?
// - `config.namespace`: optional string, what should the shared worker be named?
//   - defaults to `config.src` if undefined
// - `serverFn`: optional function, a response generator for requests from the worker
local.spawnWorkerServer = function(src, config, serverFn) {
	if (typeof config == 'function') { serverFn = config; config = null; }
	if (!config) { config = {}; }
	config.src = src;
	config.serverFn = serverFn;

	// Create the server
	var server = new local.WorkerBridgeServer(config);

	// Find an open domain and register
	var domain = config.domain;
	if (!domain) {
		if (src.indexOf('data:') === 0) {
			domain = getAvailableLocalDomain('worker{n}');
		} else {
			domain = getAvailableLocalDomain(src.split('/').pop().toLowerCase() + '{n}');
		}
	}
	local.addServer(domain, server);

	return server;
};

// EXPORTED
// Opens a stream to a peer relay
// - `providerUrl`: optional string, the relay provider
// - `config.app`: optional string, the app to join as (defaults to window.location.host)
// - `serverFn`: optional function, a response generator for requests from connected peers
local.joinRelay = function(providerUrl, config, serverFn) {
	if (typeof config == 'function') { serverFn = config; config = null; }
	if (!config) config = {};
	config.provider = providerUrl;
	config.serverFn = serverFn;
	return new local.Relay(config);
};

// helper for name assignment
function getAvailableLocalDomain(base) {
	var i = '', str;
	do {
		str = base.replace('{n}', i);
		i = (!i) ? 2 : i + 1;
	} while (local.getServer(str));
	return str;
}// Standard DOM Events
// ===================

// bindRequestEvents()
// ===================
// EXPORTED
// Converts 'click' and 'submit' events into custom 'request' events
// - within the container, all 'click' and 'submit' events will be consumed
// - 'request' events will be dispatched by the original dispatching element
// Parameters:
// - `container` must be a valid DOM element
// - `options` may disable event listeners by setting `links` or `forms` to false
function bindRequestEvents(container, options) {
	container.__localEventHandlers = [];
	options = options || {};

	var handler;
	if (options.links !== false) {
		// anchor-click handler
		handler = { name: 'click', handleEvent: Local__clickHandler, container: container };
		container.addEventListener('click', handler, false);
		container.__localEventHandlers.push(handler);
	}
	if (options.forms !== false) {
		// submitter tracking
		handler = { name: 'click', handleEvent: Local__submitterTracker, container: container };
		container.addEventListener('click', handler, true); // must be on capture to happen in time
		container.__localEventHandlers.push(handler);
		// submit handler
		handler = { name: 'submit', handleEvent: Local__submitHandler, container: container };
		container.addEventListener('submit', handler, false);
		container.__localEventHandlers.push(handler);
	}
}

// unbindRequestEvents()
// =====================
// EXPORTED
// Stops listening to 'click' and 'submit' events
function unbindRequestEvents(container) {
	if (container.__localEventHandlers) {
		container.__localEventHandlers.forEach(function(handler) {
			container.removeEventListener(handler.name, handler);
		});
		delete container.__localEventHandlers;
	}
}

// INTERNAL
// transforms click events into request events
function Local__clickHandler(e) {
	if (e.button !== 0) { return; } // handle left-click only
	var request = local.util.extractRequest.fromAnchor(e.target);
	if (request && ['_top','_blank'].indexOf(request.target) !== -1) { return; }
	if (request) {
		e.preventDefault();
		e.stopPropagation();
		local.util.dispatchRequestEvent(e.target, request);
		return false;
	}
}

// INTERNAL
// marks the submitting element (on click capture-phase) so the submit handler knows who triggered it
function Local__submitterTracker(e) {
	if (e.button !== 0) { return; } // handle left-click only
	local.util.trackFormSubmitter(e.target);
}

// INTERNAL
// transforms submit events into request events
function Local__submitHandler(e) {
	var request = local.util.extractRequest(e.target, this.container);
	if (request && ['_top','_blank'].indexOf(request.target) !== -1) { return; }
	if (request) {
		e.preventDefault();
		e.stopPropagation();
		local.util.finishPayloadFileReads(request).then(function() {
			local.util.dispatchRequestEvent(e.target, request);
		});
		return false;
	}
}

local.bindRequestEvents = bindRequestEvents;
local.unbindRequestEvents = unbindRequestEvents;})();

/** FILE: src/remotestorage.js **/
(function(global) {
  function emitUnauthorized(status){
    var args = Array.prototype.slice.call(arguments);
    if(status == 403  || status == 401) {
      this._emit('error', new RemoteStorage.Unauthorized())
    }
    var p = promising()
    return p.fulfill.apply(p,args);
  }
  function shareFirst(path){
    return ( this.backend == 'dropbox' &&
             path.match(/^\/public\/.*[^\/]$/) )
  }
  var SyncedGetPutDelete = {
    get: function(path) {
      if(this.caching.cachePath(path)) {
        return this.local.get(path);
      } else {
        return this.remote.get(path);
      }
    },
    
    put: function(path, body, contentType) {
      if(shareFirst.bind(this)(path)){
        //this.local.put(path, body, contentType);
        return SyncedGetPutDelete._wrapBusyDone.call(this, this.remote.put(path, body, contentType));
      }
      else if(this.caching.cachePath(path)) {
        return this.local.put(path, body, contentType);
      } else {
        return SyncedGetPutDelete._wrapBusyDone.call(this, this.remote.put(path, body, contentType));
      }
    },

    'delete': function(path) {
      if(this.caching.cachePath(path)) {
        return this.local.delete(path);
      } else {
        return SyncedGetPutDelete._wrapBusyDone.call(this, this.remote.delete(path));
      }
    },

    _wrapBusyDone: function(result) {
      this._emit('sync-busy');
      return result.then(function() {
        var promise = promising();
        this._emit('sync-done');
        return promise.fulfill.apply(promise, arguments);
      }.bind(this), function(err) {
        throw err;
      });
    }
  }

  var haveLocalStorage = 'localStorage' in global;

  /**
   * Class: RemoteStorage
   *
   * Constructor for global remoteStorage object.
   *
   * This class primarily contains feature detection code and a global convenience API.
   *
   * Depending on which features are built in, it contains different attributes and
   * functions. See the individual features for more information.
   *
   */
  var RemoteStorage = function() {
    /**
     * Event: ready
     *
     * fired when connected and ready
     **/
    /**
     * Event: disconnected
     * 
     * fired after disconnect
     **/
    /**
     * Event: disconnect
     *
     * depricated use disconnected
     **/
    /**
     * Event: conflict
     *
     * fired when a conflict occures
     * TODO: arguments, how does this work
     **/
    /**
     * Event: error
     *
     * fired when an error occures
     *
     * Arguments:
     * the error
     **/
    /**
     * Event: features-loaded
     *
     * fired when all features are loaded
     **/
    /**
     * Event: connecting
     *
     * fired before webfinger lookpu
     **/
    /**
     * Event: authing
     *
     * fired before redirecting to the authing server
     **/
    /**
     * Event: sync-busy
     *
     * fired when a sync cycle starts
     *
     **/
    /**
     * Event: sync-done
     *
     * fired when a sync cycle completes
     *
     **/

    RemoteStorage.eventHandling(
      this, 'ready', 'disconnected', 'disconnect', 'conflict', 'error',
      'features-loaded', 'connecting', 'authing', 'sync-busy', 'sync-done'
    );
    // pending get/put/delete calls.
    this._pending = [];
    this._setGPD({
      get: this._pendingGPD('get'),
      put: this._pendingGPD('put'),
      delete: this._pendingGPD('delete')
    });
    this._cleanups = [];
    this._pathHandlers = { change: {}, conflict: {} };
    this.apiKeys = {};
    if(haveLocalStorage) {
      try {
        this.apiKeys = JSON.parse(localStorage['remotestorage:api-keys']);
      } catch(exc) { /* ignored. */ };
      this.setBackend(localStorage['remotestorage:backend'] || 'remotestorage');
    }

    var origOn = this.on;
    this.on = function(eventName, handler) {
      if(eventName == 'ready' && this.remote.connected && this._allLoaded) {
        setTimeout(handler, 0);
      } else if(eventName == 'features-loaded' && this._allLoaded) {
        setTimeout(handler, 0);
      }
      return origOn.call(this, eventName, handler);
    }

    this._init();

    this.on('ready', function() {
      if(this.local) {
        setTimeout(this.local.fireInitial.bind(this.local), 0);
      }
    }.bind(this));
  };

  RemoteStorage.DiscoveryError = function(message) {
    Error.apply(this, arguments);
    this.message = message;
  };
  RemoteStorage.DiscoveryError.prototype = Object.create(Error.prototype);

  RemoteStorage.Unauthorized = function() { Error.apply(this, arguments); };
  RemoteStorage.Unauthorized.prototype = Object.create(Error.prototype);

  /**
   * Method: RemoteStorage.log
   *
   * Logging using console.log, when logging is enabled.
   */
  RemoteStorage.log = function() {
    if(RemoteStorage._log) {
      console.log.apply(console, arguments);
    }
  };

  RemoteStorage.prototype = {

    /**
     ** PUBLIC INTERFACE
     **/

    /**
     * Method: connect
     *
     * Connect to a remotestorage server.
     *
     * Parameters:
     *   userAddress - The user address (user@host) to connect to.
     *
     * Discovers the webfinger profile of the given user address and
     * initiates the OAuth dance.
     *
     * This method must be called *after* all required access has been claimed.
     *
     */
    connect: function(userAddress) {
      if( userAddress.indexOf('@') < 0) {
        this._emit('error', new RemoteStorage.DiscoveryError("user adress doesn't contain an @"));
        return;
      }
      this._emit('connecting');
      this.remote.configure(userAddress);
      RemoteStorage.Discover(userAddress,function(href, storageApi, authURL){
        if(!href){
          this._emit('error', new RemoteStorage.DiscoveryError('failed to contact storage server'));
          return;
        }
        this._emit('authing');
        this.remote.configure(userAddress, href, storageApi);
        if(! this.remote.connected) {
          this.authorize(authURL);
        }
      }.bind(this));
    },

    /**
     * Method: disconnect
     *
     * "Disconnect" from remotestorage server to terminate current session.
     * This method clears all stored settings and deletes the entire local cache.
     *
     * Once the disconnect is complete, the "disconnected" event will be fired.
     * From that point on you can connect again (using <connect>).
     */
    disconnect: function() {
      if(this.remote) {
        this.remote.configure(null, null, null, null);
      }
      this._setGPD({
        get: this._pendingGPD('get'),
        put: this._pendingGPD('put'),
        delete: this._pendingGPD('delete')
      });
      var n = this._cleanups.length, i = 0;
      var oneDone = function() {
        i++;
        if(i >= n) {
          this._init();
          this._emit('disconnected');
          this._emit('disconnect');// DEPRECATED?
        }
      }.bind(this);
      if(n>0) {
        this._cleanups.forEach(function(cleanup) {
          var cleanupResult = cleanup(this);
          if(typeof(cleanup) == 'object' && typeof(cleanup.then) == 'function') {
            cleanupResult.then(oneDone);
          } else {
            oneDone();
          }
        }.bind(this));
      } else {
        oneDone();
      }
    },

    setBackend: function(what) {
      this.backend = what;
      if(haveLocalStorage) {
        if(what) {
          localStorage['remotestorage:backend'] = what;
        } else {
          delete localStorage['remotestorage:backend'];
        }
      }
    },

    /**
     * Method: onChange
     *
     * Adds a 'change' event handler to the given path.
     * Whenever a 'change' happens (as determined by the backend, such
     * as <RemoteStorage.IndexedDB>) and the affected path is equal to
     * or below the given 'path', the given handler is called.
     *
     * You shouldn't need to use this method directly, but instead use
     * the "change" events provided by <RemoteStorage.BaseClient>.
     *
     * Parameters:
     *   path    - Absolute path to attach handler to.
     *   handler - Handler function.
     */
    onChange: function(path, handler) {
      if(! this._pathHandlers.change[path]) {
        this._pathHandlers.change[path] = [];
      }
      this._pathHandlers.change[path].push(handler);
    },

    onConflict: function(path, handler) {
      if(! this._conflictBound) {
        this.on('features-loaded', function() {
          if(this.local) {
            this.local.on('conflict', this._dispatchEvent.bind(this, 'conflict'));
          }
        }.bind(this));
        this._conflictBound = true;
      }
      if(! this._pathHandlers.conflict[path]) {
        this._pathHandlers.conflict[path] = [];
      }
      this._pathHandlers.conflict[path].push(handler);
    },

    /**
     * Method: enableLog
     *
     * enable logging
     */
    enableLog: function() {
      RemoteStorage._log = true;
    },

    /**
     * Method: disableLog
     *
     * disable logging
     */
    disableLog: function() {
      RemoteStorage._log = false;
    },

    /**
     * Method: log
     *
     * The same as <RemoteStorage.log>.
     */
    log: function() {
      RemoteStorage.log.apply(RemoteStorage, arguments);
    },

    setApiKeys: function(type, keys) {
      if(keys) {
        this.apiKeys[type] = keys;
      } else {
        delete this.apiKeys[type];
      }
      if(haveLocalStorage) {
        localStorage['remotestorage:api-keys'] = JSON.stringify(this.apiKeys);
      }
    },

    /**
     ** INITIALIZATION
     **/

    _init: function() {
      this._loadFeatures(function(features) {
        this.log('all features loaded');
        this.local = features.local && new features.local();
        // (this.remote set by WireClient._rs_init
        //  as lazy property on RS.prototype)

        if(this.local && this.remote) {
          this._setGPD(SyncedGetPutDelete, this);
          this._bindChange(this.local);
        } else if(this.remote) {
          this._setGPD(this.remote, this.remote);
        }

        if(this.remote) {
          this.remote.on('connected', function() {
            try {
              this._emit('ready');
            } catch(e) {
              console.error("'ready' failed: ", e, e.stack);
              this._emit('error', e);
            };
          }.bind(this));
          if(this.remote.connected) {
            try {
              this._emit('ready');
            } catch(e) {
              console.error("'ready' failed: ", e, e.stack);
              this._emit('error', e);
            };
          }
        }

        var fl = features.length;
        for(var i=0;i<fl;i++) {
          var cleanup = features[i].cleanup;
          if(cleanup) {
            this._cleanups.push(cleanup);
          }
        }

        try {
          this._allLoaded = true;
          this._emit('features-loaded');
        } catch(exc) {
          console.error("remoteStorage#ready block failed: ");
          if(typeof(exc) == 'string') {
            console.error(exc);
          } else {
            console.error(exc.message, exc.stack);
          }
          this._emit('error', exc);
        }
        this._processPending();
      });
    },

    /**
     ** FEATURE DETECTION
     **/

    _detectFeatures: function() {
      // determine availability
      var features = [
        'WireClient',
        'Dropbox',
        'GoogleDrive',
        'Access',
        'Caching',
        'Discover',
        'Authorize',
	'Widget',
        'IndexedDB',
        'LocalStorage',
        'Sync',
        'BaseClient'
      ].map(function(featureName) {
        var impl = RemoteStorage[featureName];
        return {
          name: featureName,
          init: (impl && impl._rs_init),
          supported: impl && (impl._rs_supported ? impl._rs_supported() : true),
          cleanup: ( impl && impl._rs_cleanup )
        };
      }).filter(function(feature) {
        var supported = !! (feature.init && feature.supported);
        this.log("[FEATURE " + feature.name + "] " + (supported ? '' : 'not ') + 'supported.');
        return supported;
      }.bind(this));

      features.forEach(function(feature) {
        if(feature.name == 'IndexedDB') {
          features.local = RemoteStorage.IndexedDB;
        } else if(feature.name == 'LocalStorage' && ! features.local) {
          features.local = RemoteStorage.LocalStorage;
        }
      });
      features.caching = !!RemoteStorage.Caching;
      features.sync = !!RemoteStorage.Sync;

      this.features = features;

      return features;
    },

    _loadFeatures: function(callback) {
      var features = this._detectFeatures();
      var n = features.length, i = 0;
      var self = this;
      function featureDoneCb(name) {
        return function() {
          i++;
          self.log("[FEATURE " + name + "] initialized. (" + i + "/" + n + ")");
          if(i == n)
            setTimeout(function() {
              callback.apply(self, [features]);
            }, 0);
        }
      }
      features.forEach(function(feature) {
        self.log("[FEATURE " + feature.name + "] initializing...");
        var initResult = feature.init(self);
        var cb = featureDoneCb(feature.name);
        if(typeof(initResult) == 'object' && typeof(initResult.then) == 'function') {
          initResult.then(cb);
        } else {
          cb();
        }
      });
      if(features.length==0) {
        self.log("[NO FEATURES DETECTED] done");
        callback.apply(self, [[]]);
      }
    },

    /**
     ** GET/PUT/DELETE INTERFACE HELPERS
     **/

    _setGPD: function(impl, context) {
      function wrap(f) {
        return function() {
          return f.apply(context, arguments)
            .then(emitUnauthorized.bind(this))
        }
      };
      this.get = wrap(impl.get);
      this.put = wrap(impl.put);
      this.delete = wrap(impl.delete);
    },

    _pendingGPD: function(methodName) {
      return function() {
        var promise = promising();
        this._pending.push({
          method: methodName,
          args: Array.prototype.slice.call(arguments),
          promise: promise
        });
        return promise;
      }.bind(this);
    },

    _processPending: function() {
      this._pending.forEach(function(pending) {
        try {
          this[pending.method].apply(this, pending.args).then(pending.promise.fulfill, pending.promise.reject);
        } catch(e) {
          pending.promise.reject(e);
        }
      }.bind(this));
      this._pending = [];
    },

    /**
     ** CHANGE EVENT HANDLING
     **/

    _bindChange: function(object) {
      object.on('change', this._dispatchEvent.bind(this, 'change'));
    },

    _dispatchEvent: function(eventName, event) {
      for(var path in this._pathHandlers[eventName]) {
        var pl = path.length;
        this._pathHandlers[eventName][path].forEach(function(handler) {
          if(event.path.substr(0, pl) == path) {
            var ev = {};
            for(var key in event) { ev[key] = event[key]; }
            ev.relativePath = event.path.replace(new RegExp('^' + path), '');
            try {
              handler(ev);
            } catch(e) {
              console.error("'change' handler failed: ", e, e.stack);
              this._emit('error', e);
            }
          }
        }.bind(this));
      }
    }
  };

  /**
   * Method: claimAccess
   *
   * High-level method to claim access on one or multiple scopes and enable
   * caching for them. WARNING: when using Caching control, use remoteStorage.access.claim instead,
   * see https://github.com/remotestorage/remotestorage.js/issues/380
   *
   * Examples:
   *   (start code)
   *     remoteStorage.claimAccess('foo', 'rw');
   *     // is equivalent to:
   *     remoteStorage.claimAccess({ foo: 'rw' });
   *
   *     // is equivalent to:
   *     remoteStorage.access.claim('foo', 'rw');
   *     remoteStorage.caching.enable('/foo/');
   *     remoteStorage.caching.enable('/public/foo/');
   *   (end code)
   */

  /**
   * Property: connected
   *
   * Boolean property indicating if remoteStorage is currently connected.
   */
  Object.defineProperty(RemoteStorage.prototype, 'connected', {
    get: function() {
      return this.remote.connected;
    }
  });

  /**
   * Property: access
   *
   * Tracking claimed access scopes. A <RemoteStorage.Access> instance.
   *
   *
   * Property: caching
   *
   * Caching settings. A <RemoteStorage.Caching> instance.
   *
   * (only available when caching is built in)
   *
   *
   * Property: remote
   *
   * Access to the remote backend used. Usually a <RemoteStorage.WireClient>.
   *
   *
   * Property: local
   *
   * Access to the local caching backend used.
   * Only available when caching is built in.
   * Usually either a <RemoteStorage.IndexedDB> or <RemoteStorage.LocalStorage>
   * instance.
   */

  global.RemoteStorage = RemoteStorage;

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/eventhandling.js **/
(function(global) {
  /**
   * Class: eventhandling
   */
  var methods = {
    /**
     * Method: addEventListener
     *
     * Install an event handler for the given event name.
     */
    addEventListener: function(eventName, handler) {
      this._validateEvent(eventName);
      this._handlers[eventName].push(handler);
    },

    /**
     * Method: removeEventListener
     *
     * Remove a previously installed event handler
     */
    removeEventListener: function(eventName, handler) {
      this._validateEvent(eventName);
      var hl = this._handlers[eventName].length;
      for(var i=0;i<hl;i++) {
        if(this._handlers[eventName][i] === handler) {
          this._handlers[eventName].splice(i, 1);
          return;
        }
      }
    },

    _emit: function(eventName) {
      this._validateEvent(eventName);
      var args = Array.prototype.slice.call(arguments, 1);
      this._handlers[eventName].forEach(function(handler) {
        handler.apply(this, args);
      });
    },

    _validateEvent: function(eventName) {
      if(! (eventName in this._handlers)) {
        throw new Error("Unknown event: " + eventName);
      }
    },

    _delegateEvent: function(eventName, target) {
      target.on(eventName, function(event) {
        this._emit(eventName, event);
      }.bind(this));
    },

    _addEvent: function(eventName) {
      this._handlers[eventName] = [];
    }
  };

  // Method: eventhandling.on
  // Alias for <addEventListener>
  methods.on = methods.addEventListener;

  /**
   * Function: eventHandling
   *
   * Mixes event handling functionality into an object.
   *
   * The first parameter is always the object to be extended.
   * All remaining parameter are expected to be strings, interpreted as valid event
   * names.
   *
   * Example:
   *   (start code)
   *   var MyConstructor = function() {
   *     eventHandling(this, 'connected', 'disconnected');
   *
   *     this._emit('connected');
   *     this._emit('disconnected');
   *     // this would throw an exception:
   *     //this._emit('something-else');
   *   };
   *
   *   var myObject = new MyConstructor();
   *   myObject.on('connected', function() { console.log('connected'); });
   *   myObject.on('disconnected', function() { console.log('disconnected'); });
   *   // this would throw an exception as well:
   *   //myObject.on('something-else', function() {});
   *
   *   (end code)
   */
  RemoteStorage.eventHandling = function(object) {
    var eventNames = Array.prototype.slice.call(arguments, 1);
    for(var key in methods) {
      object[key] = methods[key];
    }
    object._handlers = {};
    eventNames.forEach(function(eventName) {
      object._addEvent(eventName);
    });
  };
})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/wireclient.js **/
(function(global) {
  var RS = RemoteStorage;

  /**
   * Class: RemoteStorage.WireClient
   *
   * WireClient Interface
   * --------------------
   *
   * This file exposes a get/put/delete interface on top of XMLHttpRequest.
   * It requires to be configured with parameters about the remotestorage server to
   * connect to.
   * Each instance of WireClient is always associated with a single remotestorage
   * server and access token.
   *
   * Usually the WireClient instance can be accessed via `remoteStorage.remote`.
   *
   * This is the get/put/delete interface:
   *
   *   - #get() takes a path and optionally a ifNoneMatch option carrying a version
   *     string to check. It returns a promise that will be fulfilled with the HTTP
   *     response status, the response body, the MIME type as returned in the
   *     'Content-Type' header and the current revision, as returned in the 'ETag'
   *     header.
   *   - #put() takes a path, the request body and a content type string. It also
   *     accepts the ifMatch and ifNoneMatch options, that map to the If-Match and
   *     If-None-Match headers respectively. See the remotestorage-01 specification
   *     for details on handling these headers. It returns a promise, fulfilled with
   *     the same values as the one for #get().
   *   - #delete() takes a path and the ifMatch option as well. It returns a promise
   *     fulfilled with the same values as the one for #get().
   *
   * In addition to this, the WireClient has some compatibility features to work with
   * remotestorage 2012.04 compatible storages. For example it will cache revisions
   * from directory listings in-memory and return them accordingly as the "revision"
   * parameter in response to #get() requests. Similarly it will return 404 when it
   * receives an empty directory listing, to mimic remotestorage-01 behavior. Note
   * that it is not always possible to know the revision beforehand, hence it may
   * be undefined at times (especially for caching-roots).
   */

  var haveLocalStorage;
  var SETTINGS_KEY = "remotestorage:wireclient";

  var API_2012 = 1, API_00 = 2, API_01 = 3, API_HEAD = 4;

  var STORAGE_APIS = {
    'draft-dejong-remotestorage-00': API_00,
    'draft-dejong-remotestorage-01': API_01,
    'https://www.w3.org/community/rww/wiki/read-write-web-00#simple': API_2012
  };

  var isArrayBufferView;
  if(typeof(ArrayBufferView) === 'function') {
    isArrayBufferView = function(object) { return object && (object instanceof ArrayBufferView); };
  } else {
    var arrayBufferViews = [
      Int8Array, Uint8Array, Int16Array, Uint16Array,
      Int32Array, Uint32Array, Float32Array, Float64Array
    ];
    isArrayBufferView = function(object) {
      for(var i=0;i<8;i++) {
        if(object instanceof arrayBufferViews[i]) {
          return true;
        }
      }
      return false;
    };
  }

  function request(method, uri, token, headers, body, getEtag, fakeRevision) {
    if((method == 'PUT' || method == 'DELETE') && uri[uri.length - 1] == '/') {
      throw "Don't " + method + " on directories!";
    }

    var promise = promising();

    headers['Authorization'] = 'Bearer ' + token;

    console.log('dispatching', { method: method, url: uri, headers: headers, body: body })
    local.dispatch({ method: method, url: uri, headers: headers, body: body })
      .then(
        function(response) {
          console.log('!!!', response);
          var mimeType = response.headers['content-type'];
          var body;
          var revision = getEtag ? response.headers['etag'] : (response.status == 200 ? fakeRevision : undefined);
          if((! mimeType) || mimeType.match(/charset=binary/)) { // :TODO: binary not really supported by local yet
            var blob = new Blob([response.response], {type: mimeType});
            var reader = new FileReader();
            reader.addEventListener("loadend", function() {
              // reader.result contains the contents of blob as a typed array
              promise.fulfill(response.status, reader.result, mimeType, revision);
            });
            reader.readAsArrayBuffer(blob);
          } else {
            promise.fulfill(response.status, response.body, mimeType, revision);
          }
        },
        function(response) {
          console.log('!!!', response);
          promise.fulfill(response.status);
        }
      );

    return promise;
  }
  /*function request(method, uri, token, headers, body, getEtag, fakeRevision) {
    if((method == 'PUT' || method == 'DELETE') && uri[uri.length - 1] == '/') {
      throw "Don't " + method + " on directories!";
    }

    var promise = promising();

    headers['Authorization'] = 'Bearer ' + token;

    RS.WireClient.request(method, uri, {
      body: body,
      headers: headers
    }, function(error, response) {
      if(error) {
        promise.reject(error);
      } else {
        if(response.status == 404) {
          promise.fulfill(404);
        } else {
          var mimeType = response.getResponseHeader('Content-Type');
          var body;
          var revision = getEtag ? response.getResponseHeader('ETag') : (response.status == 200 ? fakeRevision : undefined);
          if((! mimeType) || mimeType.match(/charset=binary/)) {
            var blob = new Blob([response.response], {type: mimeType});
            var reader = new FileReader();
            reader.addEventListener("loadend", function() {
              // reader.result contains the contents of blob as a typed array
              promise.fulfill(response.status, reader.result, mimeType, revision);
            });
            reader.readAsArrayBuffer(blob);
          } else {
            body = mimeType && mimeType.match(/^application\/json/) ? JSON.parse(response.responseText) : response.responseText;
            promise.fulfill(response.status, body, mimeType, revision);
          }
        }
      }
    });
    return promise;
  }*/

  function cleanPath(path) {
    // strip duplicate slashes.
    return path.replace(/\/+/g, '/').split('/').map(encodeURIComponent).join('/');
  }
  /**
   * Class : RemoteStorage.WireClient
   **/
  RS.WireClient = function(rs) {
    this.connected = false;
    /**
     * Event: change
     *   never fired for some reason
     *
     * Event: connected
     *   fired when the wireclient connect method realizes that it is
     *   in posession of a token and a href
     **/
    RS.eventHandling(this, 'change', 'connected');
    rs.on('error', function(error){
      if(error instanceof RemoteStorage.Unauthorized) {
        this.configure(undefined, undefined, undefined, null);
      }
    }.bind(this))
    if(haveLocalStorage) {
      var settings;
      try { settings = JSON.parse(localStorage[SETTINGS_KEY]); } catch(e) {};
      if(settings) {
        setTimeout(function() {
          this.configure(settings.userAddress, settings.href, settings.storageApi, settings.token);
        }.bind(this), 0);
      }
    }

    this._revisionCache = {};

    if(this.connected) {
      setTimeout(this._emit.bind(this), 0, 'connected');
    }
  };

  RS.WireClient.REQUEST_TIMEOUT = 30000;

  RS.WireClient.prototype = {

    /**
     * Property: token
     *
     * Holds the bearer token of this WireClient, as obtained in the OAuth dance
     *
     * Example:
     *   (start code)
     *
     *   remoteStorage.remote.token
     *   // -> 'DEADBEEF01=='
     */

    /**
     * Property: href
     *
     * Holds the server's base URL, as obtained in the Webfinger discovery
     *
     * Example:
     *   (start code)
     *
     *   remoteStorage.remote.href
     *   // -> 'https://storage.example.com/users/jblogg/'
     */

    /**
     * Property: storageApi
     *
     * Holds the spec version the server claims to be compatible with
     *
     * Example:
     *   (start code)
     *
     *   remoteStorage.remote.storageApi
     *   // -> 'draft-dejong-remotestorage-01'
     */


    configure: function(userAddress, href, storageApi, token) {
      if(typeof(userAddress) !== 'undefined') this.userAddress = userAddress;
      if(typeof(href) !== 'undefined') this.href = href;
      if(typeof(storageApi) !== 'undefined') this.storageApi = storageApi;
      if(typeof(token) !== 'undefined') this.token = token;
      if(typeof(this.storageApi) !== 'undefined') {
        this._storageApi = STORAGE_APIS[this.storageApi] || API_HEAD;
        this.supportsRevs = this._storageApi >= API_00;
      }
      if(this.href && this.token) {
        this.connected = true;
        this._emit('connected');
      } else {
        this.connected = false;
      }
      if(haveLocalStorage) {
        localStorage[SETTINGS_KEY] = JSON.stringify({
          userAddress: this.userAddress,
          href: this.href,
          token: this.token,
          storageApi: this.storageApi
        });
      }
      //console.log('calling ' + RS.WireClient.configureHooks.length + ' hooks');
      RS.WireClient.configureHooks.forEach(function(hook) {
        hook.call(this);
      }.bind(this));
    },

    get: function(path, options) {
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      if(!options) options = {};
      var headers = {};
      if(this.supportsRevs) {
        if(options.ifNoneMatch)
          headers['If-None-Match'] = options.ifNoneMatch;
      } else if(options.ifNoneMatch) {
        var oldRev = this._revisionCache[path];
        if(oldRev === options.ifNoneMatch) {
//since sync descends for allKeys(local, remote), this causes
// https://github.com/remotestorage/remotestorage.js/issues/399
//commenting this out so that it gets the actual 404 from the server.
//this only affects legacy servers (this.supportsRevs==false):
//
//           return promising().fulfill(412);
        }
      }
      var promise = request('GET', this.href + cleanPath(path), this.token, headers,
                            undefined, this.supportsRevs, this._revisionCache[path]);
      if(this.supportsRevs || path.substr(-1) != '/') {
        return promise;
      } else {
        return promise.then(function(status, body, contentType, revision) {
          if(status == 200 && typeof(body) == 'object') {
            if(Object.keys(body).length === 0) {
              // no children (coerce response to 'not found')
              status = 404;
            } else {
              for(var key in body) {
                this._revisionCache[path + key] = body[key];
              }
            }
          }
          return promising().fulfill(status, body, contentType, revision);
        }.bind(this));
      }
    },

    put: function(path, body, contentType, options) {
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      if(!options) options = {};
      if(! contentType.match(/charset=/)) {
        contentType += '; charset=' + ((body instanceof ArrayBuffer || isArrayBufferView(body)) ? 'binary' : 'utf-8');
      }
      var headers = { 'Content-Type': contentType };
      if(this.supportsRevs) {
        if(options.ifMatch)
          headers['If-Match'] = options.ifMatch;
        if(options.ifNoneMatch)
          headers['If-None-Match'] = options.ifNoneMatch;
      }
      return request('PUT', this.href + cleanPath(path), this.token,
                     headers, body, this.supportsRevs);
    },

    'delete': function(path, options) {
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      if(!options) options = {};
      var headers = {};
      if(this.supportsRevs) {
        if(options.ifMatch)
          headers['If-Match'] = options.ifMatch;
      }
      return request('DELETE', this.href + cleanPath(path), this.token,
                     headers,
                     undefined, this.supportsRevs);
    }

  };

  //shared cleanPath used by Dropbox
  RS.WireClient.cleanPath = cleanPath;
  //shared isArrayBufferView used by WireClient and Dropbox
  RS.WireClient.isArrayBufferView = isArrayBufferView;
  // shared request function used by WireClient, GoogleDrive and Dropbox.
  RS.WireClient.request = function(method, url, options, callback) {
    RemoteStorage.log(method, url);

    callback = callback.bind(this);

    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      callback('timeout');
    }, RS.WireClient.REQUEST_TIMEOUT);
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if(options.responseType) {
      xhr.responseType = options.responseType;
    }
    if(options.headers) {
      for(var key in options.headers) {
        xhr.setRequestHeader(key, options.headers[key]);
      }
    }
    xhr.onload = function() {
      if(timedOut) return;
      clearTimeout(timer);
      callback(null, xhr);
    };
    xhr.onerror = function(error) {
      if(timedOut) return;
      clearTimeout(timer);
      callback(error);
    };

    var body = options.body;

    if(typeof(body) == 'object') {
      if(isArrayBufferView(body)) { /* alright. */ }
      else if(body instanceof ArrayBuffer) {
        body = new Uint8Array(body);
      } else {
        body = JSON.stringify(body);
      }
    }
    xhr.send(body);
  }

  RS.WireClient.configureHooks = [];

  RS.WireClient._rs_init = function(remoteStorage) {
    remoteStorage.remote = new RS.WireClient(remoteStorage);
  };

  RS.WireClient._rs_supported = function() {
    haveLocalStorage = 'localStorage' in global;
    return !! global.XMLHttpRequest;
  };

  RS.WireClient._rs_cleanup = function(){
    if(haveLocalStorage){
      delete localStorage[SETTINGS_KEY];
    }
  }


})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/discover.js **/
(function(global) {

  // feature detection flags
  var haveXMLHttpRequest, haveLocalStorage;
  // used to store settings in localStorage
  var SETTINGS_KEY = 'remotestorage:discover';
  // cache loaded from localStorage
  var cachedInfo = {};

  /**
   * Class: RemoteStorage.Discover
   *
   * This class deals with the webfinger lookup
   *
   * Arguments:
   * userAddress - user@host
   * callback    - gets called with href of the storage, the type and the authURL
   * Example:
   * (start code)
   *
   * (end code)
   **/

  RemoteStorage.Discover = function(userAddress, callback) {
    if(userAddress in cachedInfo) {
      var info = cachedInfo[userAddress];
      callback(info.href, info.type, info.authURL);
      return;
    }
    var hostname = userAddress.split('@')[1]
    var params = '?resource=' + encodeURIComponent('acct:' + userAddress);
    var urls = [
      'httpl://' + hostname + '/.well-known/webfinger' + params,
      'httpl://' + hostname + '/.well-known/host-meta.json' + params,
      'https://' + hostname + '/.well-known/webfinger' + params,
      'https://' + hostname + '/.well-known/host-meta.json' + params,
      'http://' + hostname + '/.well-known/webfinger' + params,
      'http://' + hostname + '/.well-known/host-meta.json' + params
    ];
    function tryOne() {
      var url = urls.shift();
      if(! url) return callback();
      RemoteStorage.log('try url', url);
      local.dispatch(url).then(
        function(res) {
          if (res.status != 200) return tryOne();
          var profile = res.body;

          if (!profile.links) {
            RemoteStorage.log("profile has no links section ", JSON.stringify(profile));
            return tryOne();
          }

          var link;
          profile.links.forEach(function(l) {
            if(l.rel == 'remotestorage') {
              link = l;
            } else if(l.rel == 'remoteStorage' && !link) {
              link = l;
            }
          });
          RemoteStorage.log('got profile', profile, 'and link', link);
          if(link) {
            var authURL = link.properties['auth-endpoint'] ||
              link.properties['http://tools.ietf.org/html/rfc6749#section-4.2'];
            cachedInfo[userAddress] = { href: link.href, type: link.type, authURL: authURL };
            if(haveLocalStorage) {
              localStorage[SETTINGS_KEY] = JSON.stringify({ cache: cachedInfo });
            }
            callback(link.href, link.type, authURL);
          } else {
            tryOne();
          }
        },
        function() {
          console.error("webfinger error", arguments, '(', url, ')');
          tryOne();
        });
    }
    tryOne();
  },



  RemoteStorage.Discover._rs_init = function(remoteStorage) {
    if(haveLocalStorage) {
      var settings;
      try { settings = JSON.parse(localStorage[SETTINGS_KEY]); } catch(e) {};
      if(settings) {
        cachedInfo = settings.cache;
      }
    }
  };

  RemoteStorage.Discover._rs_supported = function() {
    haveLocalStorage = !! global.localStorage;
    haveXMLHttpRequest = !! global.XMLHttpRequest;
    return haveXMLHttpRequest;
  }

  RemoteStorage.Discover._rs_cleanup = function() {
    if(haveLocalStorage) {
      delete localStorage[SETTINGS_KEY];
    }
  };

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/authorize.js **/
(function() {

  function extractParams() {
    //FF already decodes the URL fragment in document.location.hash, so use this instead:
    var hashPos = document.location.href.indexOf('#');
    if(hashPos == -1) return;
    var hash = document.location.href.substring(hashPos+1);
    return hash.split('&').reduce(function(m, kvs) {
      var kv = kvs.split('=');
      m[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
      return m;
    }, {});
  };

  RemoteStorage.Authorize = function(authURL, scope, redirectUri, clientId) {
    RemoteStorage.log('Authorize authURL = ',authURL)

    var url = authURL;
    url += authURL.indexOf('?') > 0 ? '&' : '?';
    url += 'redirect_uri=' + encodeURIComponent(redirectUri.replace(/#.*$/, ''));
    url += '&scope=' + encodeURIComponent(scope);
    url += '&client_id=' + encodeURIComponent(clientId);
    url += '&response_type=token';
    document.location = url;
  };

  RemoteStorage.prototype.authorize = function(authURL) {
    var scopes = this.access.scopeModeMap;
    var scope = [];
    for(var key in scopes) {
      var mode = scopes[key];
      if(key == 'root') {
        if(! this.remote.storageApi.match(/^draft-dejong-remotestorage-/)) {
          key = '';
        }
      }
      scope.push(key + ':' + mode);
    }
    scope = scope.join(' ');

    var redirectUri = String(document.location);
    var clientId = redirectUri.match(/^(https?:\/\/[^\/]+)/)[0];

    RemoteStorage.Authorize(authURL, scope, redirectUri, clientId);
  };

  RemoteStorage.Authorize._rs_supported = function(remoteStorage) {
    return typeof(document) != 'undefined';
  };

  var onFeaturesLoaded;
  RemoteStorage.Authorize._rs_init = function(remoteStorage) {
    onFeaturesLoaded = function () {
      if(params) {
        if(params.error) {
          throw "Authorization server errored: " + params.error;
        }
        if(params.access_token) {
          remoteStorage.remote.configure(undefined, undefined, undefined, params.access_token);
        }
        if(params.remotestorage) {
          remoteStorage.connect(params.remotestorage);
        }
      }
    }
    var params = extractParams();
    if(params) {
      document.location.hash = '';
    }
    remoteStorage.on('features-loaded', onFeaturesLoaded );
  }
  RemoteStorage.Authorize._rs_cleanup = function(remoteStorage) {
    remoteStorage.removeEventListener('features-loaded', onFeaturesLoaded );
  }

})();


/** FILE: src/access.js **/
(function(global) {

  var haveLocalStorage = 'localStorage' in global;
  var SETTINGS_KEY = "remotestorage:access";

  /**
   * Class: RemoteStorage.Access
   *
   * Keeps track of claimed access and scopes.
   */
  RemoteStorage.Access = function() {
    this.reset();

    if(haveLocalStorage) {
      var rawSettings = localStorage[SETTINGS_KEY];
      if(rawSettings) {
        var savedSettings = JSON.parse(rawSettings);
        for(var key in savedSettings) {
          this.set(key, savedSettings[key]);
        }
      }
    }
  };

  RemoteStorage.Access.prototype = {
    // not sure yet, if 'set' or 'claim' is better...

    /**
     * Method: claim
     *
     * Claim access on a given scope with given mode.
     *
     * Parameters:
     *   scope - An access scope, such as "contacts" or "calendar".
     *   mode  - Access mode to use. Either "r" or "rw".
     */
    claim: function() {
      this.set.apply(this, arguments);
    },

    set: function(scope, mode) {
      this._adjustRootPaths(scope);
      this.scopeModeMap[scope] = mode;
      this._persist();
    },

    get: function(scope) {
      return this.scopeModeMap[scope];
    },

    remove: function(scope) {
      var savedMap = {};
      for(var name in this.scopeModeMap) {
        savedMap[name] = this.scopeModeMap[name];
      }
      this.reset();
      delete savedMap[scope];
      for(var name in savedMap) {
        this.set(name, savedMap[name]);
      }
      this._persist();
    },

    check: function(scope, mode) {
      var actualMode = this.get(scope);
      return actualMode && (mode === 'r' || actualMode === 'rw');
    },

    reset: function() {
      this.rootPaths = [];
      this.scopeModeMap = {};
    },

    _adjustRootPaths: function(newScope) {
      if('root' in this.scopeModeMap || newScope === 'root') {
        this.rootPaths = ['/'];
      } else if(! (newScope in this.scopeModeMap)) {
        this.rootPaths.push('/' + newScope + '/');
        this.rootPaths.push('/public/' + newScope + '/');
      }
    },

    _persist: function() {
      if(haveLocalStorage) {
        localStorage[SETTINGS_KEY] = JSON.stringify(this.scopeModeMap);
      }
    },

    setStorageType: function(type) {
      this.storageType = type;
    }
  };

  /**
   * Property: scopes
   *
   * Holds an array of claimed scopes in the form
   * > { name: "<scope-name>", mode: "<mode>" }
   *
   * Example:
   *   (start code)
   *   remoteStorage.access.claim('foo', 'r');
   *   remoteStorage.access.claim('bar', 'rw');
   *
   *   remoteStorage.access.scopes
   *   // -> [ { name: 'foo', mode: 'r' }, { name: 'bar', mode: 'rw' } ]
   */
  Object.defineProperty(RemoteStorage.Access.prototype, 'scopes', {
    get: function() {
      return Object.keys(this.scopeModeMap).map(function(key) {
        return { name: key, mode: this.scopeModeMap[key] };
      }.bind(this));
    }
  });

  Object.defineProperty(RemoteStorage.Access.prototype, 'scopeParameter', {
    get: function() {
      return this.scopes.map(function(scope) {
        return (scope.name === 'root' && this.storageType === '2012.04' ? '' : scope.name) + ':' + scope.mode;
      }.bind(this)).join(' ');
    }
  });

  // documented in src/remotestorage.js
  Object.defineProperty(RemoteStorage.prototype, 'access', {
    get: function() {
      var access = new RemoteStorage.Access();
      Object.defineProperty(this, 'access', {
        value: access
      });
      return access;
    },
    configurable: true
  });

  function setModuleCaching(remoteStorage, key) {
    if(key == 'root' || key === '') {
      remoteStorage.caching.set('/', { data: true });
    } else {
      remoteStorage.caching.set('/' + key + '/', { data: true });
      remoteStorage.caching.set('/public/' + key + '/', { data: true });
    }
  }

  // documented in src/remotestorage.js
  RemoteStorage.prototype.claimAccess = function(scopes) {
    if(typeof(scopes) === 'object') {
      for(var key in scopes) {
        this.access.claim(key, scopes[key]);
      }
    } else {
      this.access.claim(arguments[0], arguments[1])
    }
  };

  RemoteStorage.Access._rs_init = function() {};

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/assets.js **/
/** THIS FILE WAS GENERATED BY build/compile-assets.js. DO NOT CHANGE IT MANUALLY, BUT INSTEAD CHANGE THE ASSETS IN assets/. **/
RemoteStorage.Assets = {

  connectIcon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTYiIHdpZHRoPSIxNiIgdmVyc2lvbj0iMS4xIiB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIiB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iPgogPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCAtMTAzNi40KSI+CiAgPHBhdGggZD0ibTEgMTA0Ny40di02aDd2LTRsNyA3LTcgN3YtNHoiIGZpbGw9IiNmZmYiLz4KIDwvZz4KPC9zdmc+Cg==',
  disconnectIcon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTYiIHdpZHRoPSIxNiIgdmVyc2lvbj0iMS4wIiB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj4KIDxwYXRoIHN0eWxlPSJibG9jay1wcm9ncmVzc2lvbjp0Yjt0ZXh0LWluZGVudDowO2NvbG9yOiMwMDAwMDA7dGV4dC10cmFuc2Zvcm06bm9uZSIgZD0ibTguMDAwMSAwYy0wLjQ3MTQgMC0wLjk2MTAzIDAuNTQxOS0wLjk1IDF2NmMtMC4wMDc0NyAwLjUyODMxIDAuNDIxNjMgMSAwLjk1IDFzMC45NTc0Ny0wLjQ3MTY5IDAuOTUtMXYtNmMwLjAxNDYyMi0wLjYwNTEtMC40Nzg2LTEtMC45NS0xem0tMy4zNDM4IDIuNWMtMC4wODcxODYgMC4wMTkyOTQtMC4xNzE2MyAwLjA1MDk1OS0wLjI1IDAuMDkzNzUtMi45OTk1IDEuNTcxNS0zLjkxODQgNC43OTc5LTMuMTI1IDcuNDY4OCAwLjc5MzQgMi42NyAzLjI3OTkgNC45MzcgNi42ODc1IDQuOTM3IDMuMzU5MiAwIDUuODc3Mi0yLjE0OSA2LjcxOTItNC43ODEgMC44NDEtMi42MzIxLTAuMDU4LTUuODIzNC0zLjEyNS03LjU5NC0wLjQzNC0wLjI1MzYtMS4wNTktMC4wODk5LTEuMzEzIDAuMzQzNy0wLjI1MzYgMC40MzM2LTAuMDkgMS4wNTg5IDAuMzQ0IDEuMzEyNSAyLjM5MDggMS4zNzk4IDIuODgyNSAzLjQ5NDQgMi4yODEyIDUuMzc1LTAuNjAxMiAxLjg4MDYtMi4zNDQgMy40Mzc1LTQuOTA2MiAzLjQzNzUtMi41NzU5IDAtNC4yOTc2LTEuNjUwMi00Ljg3NS0zLjU5MzgtMC41Nzc2LTEuOTQzNS0wLjA0Ny00LjA0OCAyLjE4NzMtNS4yMTg3IDAuMzc4Ny0wLjIwNjMgMC41NzkxLTAuNjkyNSAwLjQ1NTgtMS4xMDU3LTAuMTIzMi0wLjQxMzMtMC41NTcyLTAuNzEwMy0wLjk4Ny0wLjY3NTUtMC4wMzEzLTAuMDAxNS0wLjA2MjYtMC4wMDE1LTAuMDkzOCAweiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4K',
  dropbox: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3QgPEBAhEOpfuQAABhZJREFUWMPVl31snVUdxz+/5/2577e3b7QbHaOD0nXshW4ZZkpGQmJYZkJUDAaZzCBGAxGd+pdZQsJIjCaKgFu09GWybIggm8yhMCsY92rcOkPHunbdtKOUbX36svX23uc+xz+eDsrWlztiNJzk5D7JPS+fc8739/2dA5+EsqJtyK18ZlCKbX9Lk6fd1uo5xbTVZmtwa4v35Np5Mry4TLYXCzAnyhsry2SwrmnokdnaTruq6i3e0lXl0tqQlkURCxwdDp9Th5p3+p9iS8afqk/VZq9kaZoDN8apdU3B1KFnmLde7AkezH0n3V0UQOJpz2hIsqEhLU+WOeAagmtCxISYBe1nVf4vfWrByYdSpyf3W9ziLapy6JgbAduAiBn2S1rCQBYODAQP7H01/zxby4JpAW5s8mproxypiRKNGIJrQNT8EMA1wTGEU8MBP/q7umPw0dSbAA3N3n3zI2yLG2oScPgbNYWICY4Be86o/le6g0W576bPXQWwcqvXdJ2t1idMsA1hJoCoCRfGYdOhwsa4TUWFrr7pGmDrzAiQCHfD//Xxwk/33Z/6HoA0tnhLXZ3XMoYqsy4PYs4M4Ohg6pB2ddqO+vR6BWL27AARXbBNiBjwh9Oqs+O8ukcT4eaopjLqGsJSCdSX29SX23x/lctXlzgE1zBAANxWIQuGxlWNACxr8WozJp0lljKsGXbA0qGu1GRBxsTUQRAGLgboIuQVvHI8S+f7eeK2TLsDSQd296rhPaeDm09+PdX/gQYqN3uZ+jh7ro+oRusKDdgmVEY1GqstSiOhdegCmoQAIoImIWTPYIHdXVlyBYhaVwLA70+rPz7fllvLi2W5KcPw9q3eS/VJ7kmYgm1A3BIWV5osq7IIlMLUQJOrAXQBXQtr1BR2d2XpOu8TtULR+gq2nQh+vv8rqUdnNaKGZm/9qnJpmp/U+fxCB5lYsaGFdTYAY9L3jmNj9F9S7OgKVh9/KNVelBVf8untv8TYSS8gbsrHyh8C2LqQtGE0z9CJYfVuUblgRZv3WGOJvJG0cF8/lWPNdo+O93xsHYoVuqkL/xzIs/HPHt2DPg0Zko+v0I8vbfHun9aKE5sH9YaobJsf5V4mRLXv33kSlmAYwspqgw23R7A1EJlahKYOSsHTB0cZHQ9IOBA3NSrjGo4hWAY82xH8rH1b/jF2laoPAOb80jPqYtKTMdRcTQNd+xAgbgmuJbiGELfh3lsc7q41KQSTABBcC1qPjLH/XzniNqScsP1kgMsm9nJ34e2mNcmFAMby1qFPZyz1WlxXrprhuEUgUPDbd8Y59n6edbe61KZ1TF14vSfPLw5dYjhXIOMIM6lGAV+u0+tv+ttI/2+6/LsMQVXpUFCAqJkS9MT5anB2NGDjWxf5Yp3DvjN5th/LUhETolaRTqigxMGIWVKtHVyX2tGTJd2X5agUIfi8CmvUFOKGT++gT8wqLlKUgnwATxwq7P32m35Z+32pPQZA54MpH1iSb/XWZmx2VthTD1AATCBlCZ+dpwNg6EJjlUH3hQIKRaCujhZFaOPtfUH+8HvBnQceSP11yjA8vC616+A5FevL8jt/YiCR0HiQcAUVrnDHHO0jHTUNllXrpC0NRXiefjAxM4rhHLzQpZqf+eFFd/LkM17JGlu9p+xC8IgPhGlaqE1rNJZrxOzQok0dnjviY+nhbSntCH3DAWN+QMIWEhYsqTD4wYHChrPfSP9kqnmM6QAMkYtz4xqmDqeGA+rLNObGZVozkglx1ZfqZAvC2ZGAz9RYlEbAlsLoNd+Kx5RqO5/njKXDsnKdhCXFOaFAZUzjznlhyt5xIjiSLbBz2oVO98fRdalOoGZ5m/dUQ4pvJZ3Zr/CXlS5A74gabzlYePztr6U2faxr+eRy/RYvtjgjHauvkxvi9oTDXaGBuAUJWyh1hb3vqsOvfiG5/L/yMAE483BqdNeuXO3LvcGX3vEUhsZVsaYL9IzACz3BXcVOXvQOfKRsupBZv8R4bnW19rmqGPzqHz4BcMGn5U/Hgod5oiT3P3kvVj7rrfnx/pHBu7d7Azc1eY3/l0drzWbPXNjsGXySy38AbtMqneWU7BkAAAAASUVORK5CYII=',
  googledrive: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3QgPEA85ztzJcQAABZVJREFUWMPtl1uoXVcVhr8x5tprn7M1NG1i0pQqSG2jLcXipYJXjPogqFgpaHMSFUkpIjU+leKbDxIQSiHgjZgmrfXgQ6SKj5Ji7YVS05aUUqKQlNLQeDnN5Zzk9Jy99xy/D3OttU/StDlV33TBZM3FXmuMf/5jjv+fG/7XL1vti9tnv3Dtnnf+87JY8YmZNxEMM1sZ7tWpjz764mriVqvKvmfb1ONLy3+dGyWu6EWbvQwoydv5BMSqFuereakmfnls1GP25IDaBGYYjplhljDz5tk7YMtPfurAf6UE9Z6tNwDPAPXwtcxL1x9n4zRgDjjm1gCyC6JpCLoW/OX65of1nzCwG6gNo3aYeXF981mTvK2/WWFiMmoj7X+z5JcE0N87c4e7b3EvyTwZT5/r8ezZHu6GuWGpSegJ8/ZeBu6fHv35s1/7t0rQv29mjWF/ATZ1L4bQwohrpkYc/sBpwhJYAVdKYECzYAESIk4Am3sf+sPCW2LAzb9jbpvMDXfD3fEqkRIcGdbsevlt9LylPYG1K6/K3QzK75uAr78lBgb3b7sc2cl2Uaa21sDiGMvB2iQeu/EMm6bKHjD3SUsCEChnpEAKiLisd/PB+UsyMPjZNwzzh1ixcnOfsFCX51NU/PTvA6pkTUdYw4R3zyu1ArMDqyvBQB82+FiJUQJ4C8YgVT1SSvSTs+vEmkcwe7qEsUnt233Aij0BW4ZPbfngKpRQs7hXpYQNvRiuEtATWOW4bLi+z04pJbCnBAkBJggBQlIBIZCUJM0Cm9+QgcED2+/G7BprdMZaAFZExm1FWcz+NLdj32G/6XfPCB5GoJKp7H5FARHRtgRI1y0/+cm7Lwpg+v7t64DvNd5S2mqirKXHy6RoArp1Ykrc2hKtKCtXlNEyoQ6Ydi498fF1F2FAdwEbV9UnZne+8q19Z7o63vTb+TPnRneeWxwxHGdyziii6wApQNEydKUUd5wHYGrftvci7tKKLSME5bvCaruynI9rNL7vdZgiHhiP898Wl8bMnxty+uyIhcURo1FgjSg1DCDph4uPfuR9AFbvvS25p2cxbiyKVuh2o1O44n2lLLacb5v75v5fX6yl5h753IwUD+YcRAQ5B6FMMhj0jboSRhnAE258wvp7Z7aYcbCYCeCGt97ubfICLDP/q4WZ32x7M20fPfb+hxbH9ZdjHOQIIoR74EDywA3coa6MqtJnrP+LmRmcB63ob8dA1wllRm95LVc//22S16TGeKqqpqoHk10ESGJj/zjjgIhAISKCyJmcY6Uu8Pbq7C0V6ABh35dzvYWQG0QAhmSYCaUlNhzdCrlX2jpE6tV4b9DYcGFKEgG8svQucoicC4CsII8zeTxutAEQzx1duPL3vrxjdlnou0SDLdTulxJQmalXNzN98jpEJiSo+qTeoEnsnWC5lVZNRhkOZiq0G8XCmz1gpp3j/ZYdYLhj9qCkn3fJQ4QKeh9OccWxz6O0hGKM9wakeoBEZ1BmqfOMyYFk4gXS+edG4J4ju6/644VK+AOJhSIYpVRBpn/qPVRL65A51dRavJoG2UQkOqf0hgVrGG7u6syoJDObB+55nRANb589Afy40W0UwkY91h39CiLweg1UU+W3ohLNvC2VurJ1htR6A3QaYPCjI7uvOvGGOlfv2XoSuBzEhmNfZXDqBrweUPVqUlWodneSG+6J1NTevThfDpEjmnsmzuuCPPfCvRvfcakT0S2Aeq9tYPr0ZryeBvOOlZBKUIEiCAVZwTgy41x6v6hm0LFZ4o7N7IuXPA+EDx+XjQ+tP/4lUrW2vCI1ydR0iYgmWdtu4yzG7bOiAdn8iYlA0iFJh1Z1JJv+ye2b3n1419XRH2riP0aqqlKClABIjUMW+rtSlw5qmCpgsynnl56/d+M/+P91wfUvQjDgTzx9h9AAAAAASUVORK5CYII=',
  remoteStorageIcon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMzIiIHdpZHRoPSIzMiIgdmVyc2lvbj0iMS4xIiB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj4KIDxkZWZzPgogIDxyYWRpYWxHcmFkaWVudCBpZD0iYSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGN5PSI1NzEuNDIiIGN4PSIxMDQ2LjUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLjE0NDMzIDAgMCAuMTY2NjcgMTIwMS41IDg3Ny4xMSkiIHI9Ijk2Ij4KICAgPHN0b3Agc3RvcC1jb2xvcj0iI2ZmNGEwNCIgc3RvcC1vcGFjaXR5PSIuNzYxNTQiIG9mZnNldD0iMCIvPgogICA8c3RvcCBzdG9wLWNvbG9yPSIjZmY0YTA0IiBvZmZzZXQ9IjEiLz4KICA8L3JhZGlhbEdyYWRpZW50PgogPC9kZWZzPgogPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTEzMzYuNiAtOTU2LjM1KSI+CiAgPHBhdGggc3R5bGU9ImNvbG9yOiMwMDAwMDAiIGQ9Im0xMzUyLjYgOTU2LjM1IDAuMjg4NiAxNS4xMzYgMTMuNTY3LTcuMTM1Mi0xMy44NTUtOC4wMDExemwtMTMuODU1IDguMDAxMSAxMy41NjcgNy4xMzUyIDAuMjg4Ny0xNS4xMzZ6bS0xMy44NTUgOC4wMDExdjE1Ljk5OGwxMi45NTgtNy44MTYyLTEyLjk1OC04LjE4MTV6bTAgMTUuOTk4IDEzLjg1NSA4LjAwMTEtMC42MDg5LTE1LjMxNy0xMy4yNDYgNy4zMTU2em0xMy44NTUgOC4wMDExIDEzLjg1NS04LjAwMTEtMTMuMjUxLTcuMzE1Ni0wLjYwNDQgMTUuMzE3em0xMy44NTUtOC4wMDExdi0xNS45OThsLTEyLjk2MiA4LjE4MTUgMTIuOTYyIDcuODE2MnoiIGZpbGw9InVybCgjYSkiLz4KIDwvZz4KPC9zdmc+Cg==',
  remoteStorageIconError: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMzIiIHdpZHRoPSIzMiIgdmVyc2lvbj0iMS4xIiB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj4KIDxkZWZzPgogIDxyYWRpYWxHcmFkaWVudCBpZD0iYSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGN5PSI1NzEuNDIiIGN4PSIxMDQ2LjUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLjE0NDMzIDAgMCAuMTY2NjcgMTIwMS41IDg3Ny4xMSkiIHI9Ijk2Ij4KICAgPHN0b3Agc3RvcC1jb2xvcj0iI2U5MDAwMCIgc3RvcC1vcGFjaXR5PSIuNzYwNzgiIG9mZnNldD0iMCIvPgogICA8c3RvcCBzdG9wLWNvbG9yPSIjZTkwMDAwIiBvZmZzZXQ9IjEiLz4KICA8L3JhZGlhbEdyYWRpZW50PgogPC9kZWZzPgogPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTEzMzYuNiAtOTU2LjM1KSI+CiAgPHBhdGggc3R5bGU9ImNvbG9yOiMwMDAwMDAiIGQ9Im0xMzUyLjYgOTU2LjM1IDAuMjg4NiAxNS4xMzYgMTMuNTY3LTcuMTM1Mi0xMy44NTUtOC4wMDExemwtMTMuODU1IDguMDAxMSAxMy41NjcgNy4xMzUyIDAuMjg4Ny0xNS4xMzZ6bS0xMy44NTUgOC4wMDExdjE1Ljk5OGwxMi45NTgtNy44MTYyLTEyLjk1OC04LjE4MTV6bTAgMTUuOTk4IDEzLjg1NSA4LjAwMTEtMC42MDg5LTE1LjMxNy0xMy4yNDYgNy4zMTU2em0xMy44NTUgOC4wMDExIDEzLjg1NS04LjAwMTEtMTMuMjUxLTcuMzE1Ni0wLjYwNDQgMTUuMzE3em0xMy44NTUtOC4wMDExdi0xNS45OThsLTEyLjk2MiA4LjE4MTUgMTIuOTYyIDcuODE2MnoiIGZpbGw9InVybCgjYSkiLz4KIDwvZz4KPC9zdmc+Cg==',
  remoteStorageIconOffline: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMzIiIHdpZHRoPSIzMiIgdmVyc2lvbj0iMS4xIiB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIj4KIDxkZWZzPgogIDxyYWRpYWxHcmFkaWVudCBpZD0iYSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGN5PSI1NzEuNDIiIGN4PSIxMDQ2LjUiIGdyYWRpZW50VHJhbnNmb3JtPSJtYXRyaXgoLjE0NDMzIDAgMCAuMTY2NjcgMTIwMS41IDg3Ny4xMSkiIHI9Ijk2Ij4KICAgPHN0b3Agc3RvcC1jb2xvcj0iIzY5Njk2OSIgc3RvcC1vcGFjaXR5PSIuNzYxNTQiIG9mZnNldD0iMCIvPgogICA8c3RvcCBzdG9wLWNvbG9yPSIjNjc2NzY3IiBvZmZzZXQ9IjEiLz4KICA8L3JhZGlhbEdyYWRpZW50PgogPC9kZWZzPgogPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTEzMzYuNiAtOTU2LjM1KSI+CiAgPHBhdGggc3R5bGU9ImNvbG9yOiMwMDAwMDAiIGQ9Im0xMzUyLjYgOTU2LjM1IDAuMjg4NiAxNS4xMzYgMTMuNTY3LTcuMTM1Mi0xMy44NTUtOC4wMDExemwtMTMuODU1IDguMDAxMSAxMy41NjcgNy4xMzUyIDAuMjg4Ny0xNS4xMzZ6bS0xMy44NTUgOC4wMDExdjE1Ljk5OGwxMi45NTgtNy44MTYyLTEyLjk1OC04LjE4MTV6bTAgMTUuOTk4IDEzLjg1NSA4LjAwMTEtMC42MDg5LTE1LjMxNy0xMy4yNDYgNy4zMTU2em0xMy44NTUgOC4wMDExIDEzLjg1NS04LjAwMTEtMTMuMjUxLTcuMzE1Ni0wLjYwNDQgMTUuMzE3em0xMy44NTUtOC4wMDExdi0xNS45OThsLTEyLjk2MiA4LjE4MTUgMTIuOTYyIDcuODE2MnoiIGZpbGw9InVybCgjYSkiLz4KIDwvZz4KPC9zdmc+Cg==',
  syncIcon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGVuYWJsZS1iYWNrZ3JvdW5kPSJuZXcgMCAwIDg3LjUgMTAwIiB4bWw6c3BhY2U9InByZXNlcnZlIiBoZWlnaHQ9IjE2IiB2aWV3Qm94PSIwIDAgMTUuOTk5OTk5IDE2IiB3aWR0aD0iMTYiIHZlcnNpb249IjEuMSIgeT0iMHB4IiB4PSIwcHgiIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+CjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKC01LjUxMTIgLTc2LjUyNSkiIGRpc3BsYXk9Im5vbmUiPgoJPHBhdGggZGlzcGxheT0iaW5saW5lIiBkPSJtNTEuNDczIDQyLjI1NS0yLjIwNSAyLjIxMmMxLjQ3OCAxLjQ3NyAyLjI5NSAzLjQ0MiAyLjI5NSA1LjUzMyAwIDQuMzA5LTMuNTA0IDcuODEyLTcuODEyIDcuODEydi0xLjU2MmwtMy4xMjUgMy4xMjUgMy4xMjQgMy4xMjV2LTEuNTYyYzYuMDI5IDAgMTAuOTM4LTQuOTA2IDEwLjkzOC0xMC45MzggMC0yLjkyNy0xLjE0MS01LjY3Ni0zLjIxNS03Ljc0NXoiLz4KCTxwYXRoIGRpc3BsYXk9ImlubGluZSIgZD0ibTQ2Ljg3NSA0MC42MjUtMy4xMjUtMy4xMjV2MS41NjJjLTYuMDMgMC0xMC45MzggNC45MDctMTAuOTM4IDEwLjkzOCAwIDIuOTI3IDEuMTQxIDUuNjc2IDMuMjE3IDcuNzQ1bDIuMjAzLTIuMjEyYy0xLjQ3Ny0xLjQ3OS0yLjI5NC0zLjQ0Mi0yLjI5NC01LjUzMyAwLTQuMzA5IDMuNTA0LTcuODEyIDcuODEyLTcuODEydjEuNTYybDMuMTI1LTMuMTI1eiIvPgo8L2c+CjxwYXRoIGZpbGw9IiNmZmYiIGQ9Im0xMCAwbC0wLjc1IDEuOTA2MmMtMS4wMDc4LTAuMjk0Mi0zLjQ1ODYtMC43NzA4LTUuNjU2MiAwLjkzNzYgMC0wLjAwMDItMy45MzAyIDIuNTk0MS0yLjA5MzggNy41OTQybDEuNjU2Mi0wLjcxOTJzLTEuNTM5OS0zLjExMjIgMS42ODc2LTUuNTMxM2MwIDAgMS42OTU3LTEuMTMzOSAzLjY4NzQtMC41OTM3bC0wLjcxODcgMS44MTI0IDMuODEyNS0xLjYyNS0xLjYyNS0zLjc4MTJ6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0ibTE0IDUuNTYyNWwtMS42NTYgMC43MTg3czEuNTQxIDMuMTEzNS0xLjY4OCA1LjUzMDhjMCAwLTEuNzI3MiAxLjEzNS0zLjcxODUgMC41OTRsMC43NS0xLjgxMi0zLjgxMjUgMS41OTQgMS41OTM4IDMuODEyIDAuNzgxMi0xLjkwNmMxLjAxMTMgMC4yOTUgMy40NjE1IDAuNzY2IDUuNjU2LTAuOTM4IDAgMCAzLjkyOC0yLjU5NCAyLjA5NC03LjU5MzV6Ii8+Cjwvc3ZnPgo=',
  widget: ' <div class="rs-bubble rs-hidden">   <div class="rs-bubble-text remotestorage-initial remotestorage-error remotestorage-authing remotestorage-offline">     <span class="rs-status-text">       Connect <strong>remote Storage</strong>     </span>   </div>   <div class="rs-bubble-expandable">     <!-- error -->     <div class="remotestorage-error">       <pre class="rs-status-text rs-error-msg">ERROR</pre>          <button class="remotestorage-reset">get me out of here</button>     <p class="rs-centered-text"> If this problem persists, please <a href="http://remotestorage.io/community/" target="_blank">let us know</a>!</p>     </div>     <!-- connected -->     <div class="rs-bubble-text remotestorage-connected">       <strong class="userAddress"> User Name </strong>       <span class="remotestorage-unauthorized">         <br/>Unauthorized! Click to reconnect.<br/>       </span>     </div>     <div class="content remotestorage-connected">       <button class="rs-sync" title="sync">  <img>  </button>       <button class="rs-disconnect" title="disconnect">  <img>  </button>     </div>     <!-- initial -->     <form novalidate class="remotestorage-initial">       <input  type="email" placeholder="user@host" name="userAddress" novalidate>       <button class="connect" name="connect" title="connect" disabled="disabled">         <img>       </button>     </form>     <div class="rs-info-msg remotestorage-initial">       This app allows you to use your own storage! Find more info on       <a href="http://remotestorage.io/" target="_blank">remotestorage.io</a>     </div>      </div> </div>   <img class="rs-dropbox rs-backends rs-action" alt="Connect to Dropbox"> <img class="rs-googledrive rs-backends rs-action" alt="Connect to Google Drive">  <img class="rs-cube rs-action"> ',
  widgetCss: '/** encoding:utf-8 **/ /* RESET */ #remotestorage-widget{text-align:left;}#remotestorage-widget input, #remotestorage-widget button{font-size:11px;}#remotestorage-widget form input[type=email]{margin-bottom:0;/* HTML5 Boilerplate */}#remotestorage-widget form input[type=submit]{margin-top:0;/* HTML5 Boilerplate */}/* /RESET */ #remotestorage-widget, #remotestorage-widget *{-moz-box-sizing:border-box;box-sizing:border-box;}#remotestorage-widget{position:absolute;right:10px;top:10px;font:normal 16px/100% sans-serif !important;user-select:none;-webkit-user-select:none;-moz-user-select:-moz-none;cursor:default;z-index:10000;}#remotestorage-widget .rs-bubble{background:rgba(80, 80, 80, .7);border-radius:5px 15px 5px 5px;color:white;font-size:0.8em;padding:5px;position:absolute;right:3px;top:9px;min-height:24px;white-space:nowrap;text-decoration:none;}.rs-bubble .rs-bubble-text{padding-right:32px;/* make sure the bubble doesn\'t "jump" when initially opening. */ min-width:182px;}#remotestorage-widget .rs-action{cursor:pointer;}/* less obtrusive cube when connected */ #remotestorage-widget.remotestorage-state-connected .rs-cube, #remotestorage-widget.remotestorage-state-busy .rs-cube{opacity:.3;-webkit-transition:opacity .3s ease;-moz-transition:opacity .3s ease;-ms-transition:opacity .3s ease;-o-transition:opacity .3s ease;transition:opacity .3s ease;}#remotestorage-widget.remotestorage-state-connected:hover .rs-cube, #remotestorage-widget.remotestorage-state-busy:hover .rs-cube, #remotestorage-widget.remotestorage-state-connected .rs-bubble:not(.rs-hidden) + .rs-cube{opacity:1 !important;}#remotestorage-widget .rs-backends{position:relative;top:5px;right:0;}#remotestorage-widget .rs-cube{position:relative;top:5px;right:0;}/* pulsing animation for cube when loading */ #remotestorage-widget .rs-cube.remotestorage-loading{-webkit-animation:remotestorage-loading .5s ease-in-out infinite alternate;-moz-animation:remotestorage-loading .5s ease-in-out infinite alternate;-o-animation:remotestorage-loading .5s ease-in-out infinite alternate;-ms-animation:remotestorage-loading .5s ease-in-out infinite alternate;animation:remotestorage-loading .5s ease-in-out infinite alternate;}@-webkit-keyframes remotestorage-loading{to{opacity:.7}}@-moz-keyframes remotestorage-loading{to{opacity:.7}}@-o-keyframes remotestorage-loading{to{opacity:.7}}@-ms-keyframes remotestorage-loading{to{opacity:.7}}@keyframes remotestorage-loading{to{opacity:.7}}#remotestorage-widget a{text-decoration:underline;color:inherit;}#remotestorage-widget form{margin-top:.7em;position:relative;}#remotestorage-widget form input{display:table-cell;vertical-align:top;border:none;border-radius:6px;font-weight:bold;color:white;outline:none;line-height:1.5em;height:2em;}#remotestorage-widget form input:disabled{color:#999;background:#444 !important;cursor:default !important;}#remotestorage-widget form input[type=email]:focus{background:#223;}#remotestorage-widget form input[type=email]{background:#000;width:100%;height:26px;padding:0 30px 0 5px;border-top:1px solid #111;border-bottom:1px solid #999;}#remotestorage-widget form input[type=email]:focus{background:#223;}#remotestorage-widget button:focus, #remotestorage-widget input:focus{box-shadow:0 0 4px #ccc;}#remotestorage-widget form input[type=email]::-webkit-input-placeholder{color:#999;}#remotestorage-widget form input[type=email]:-moz-placeholder{color:#999;}#remotestorage-widget form input[type=email]::-moz-placeholder{color:#999;}#remotestorage-widget form input[type=email]:-ms-input-placeholder{color:#999;}#remotestorage-widget form input[type=submit]{background:#000;cursor:pointer;padding:0 5px;}#remotestorage-widget form input[type=submit]:hover{background:#333;}#remotestorage-widget .rs-info-msg{font-size:10px;color:#eee;margin-top:0.7em;white-space:normal;}#remotestorage-widget .rs-info-msg.last-synced-message{display:inline;white-space:nowrap;margin-bottom:.7em}#remotestorage-widget .rs-info-msg a:hover, #remotestorage-widget .rs-info-msg a:active{color:#fff;}#remotestorage-widget button img{vertical-align:baseline;}#remotestorage-widget button{border:none;border-radius:6px;font-weight:bold;color:white;outline:none;line-height:1.5em;height:26px;width:26px;background:#000;cursor:pointer;margin:0;padding:5px;}#remotestorage-widget button:hover{background:#333;}#remotestorage-widget .rs-bubble button.connect{display:block;background:none;position:absolute;right:0;top:0;opacity:1;/* increase clickable area of connect button */ margin:-5px;padding:10px;width:36px;height:36px;}#remotestorage-widget .rs-bubble button.connect:not([disabled]):hover{background:rgba(150,150,150,.5);}#remotestorage-widget .rs-bubble button.connect[disabled]{opacity:.5;cursor:default !important;}#remotestorage-widget .rs-bubble button.rs-sync{position:relative;left:-5px;bottom:-5px;padding:4px 4px 0 4px;background:#555;}#remotestorage-widget .rs-bubble button.rs-sync:hover{background:#444;}#remotestorage-widget .rs-bubble button.rs-disconnect{background:#721;position:absolute;right:0;bottom:0;padding:4px 4px 0 4px;}#remotestorage-widget .rs-bubble button.rs-disconnect:hover{background:#921;}#remotestorage-widget .remotestorage-error-info{color:#f92;}#remotestorage-widget .remotestorage-reset{width:100%;background:#721;}#remotestorage-widget .remotestorage-reset:hover{background:#921;}#remotestorage-widget .rs-bubble .content{margin-top:7px;}#remotestorage-widget pre{user-select:initial;-webkit-user-select:initial;-moz-user-select:text;max-width:27em;margin-top:1em;overflow:auto;}#remotestorage-widget .rs-centered-text{text-align:center;}#remotestorage-widget .rs-bubble.rs-hidden{padding-bottom:2px;border-radius:5px 15px 15px 5px;}#remotestorage-widget .rs-error-msg{min-height:5em;}.rs-bubble.rs-hidden .rs-bubble-expandable{display:none;}.remotestorage-state-connected .rs-bubble.rs-hidden{display:none;}.remotestorage-connected{display:none;}.remotestorage-state-connected .remotestorage-connected{display:block;}.remotestorage-initial{display:none;}.remotestorage-state-initial .remotestorage-initial{display:block;}.remotestorage-error{display:none;}.remotestorage-state-error .remotestorage-error{display:block;}.remotestorage-state-authing .remotestorage-authing{display:block;}.remotestorage-state-offline .remotestorage-connected, .remotestorage-state-offline .remotestorage-offline{display:block;}.remotestorage-unauthorized{display:none;}.remotestorage-state-unauthorized .rs-bubble.rs-hidden{display:none;}.remotestorage-state-unauthorized .remotestorage-connected, .remotestorage-state-unauthorized .remotestorage-unauthorized{display:block;}.remotestorage-state-unauthorized .rs-sync{display:none;}.remotestorage-state-busy .rs-bubble.rs-hidden{display:none;}.remotestorage-state-busy .rs-bubble{display:block;}.remotestorage-state-busy .remotestorage-connected{display:block;}.remotestorage-state-authing .rs-bubble-expandable{display:none;}'
};


/** FILE: src/widget.js **/
(function(window) {

  var haveLocalStorage;
  var LS_STATE_KEY = "remotestorage:widget:state";
  // states allowed to immediately jump into after a reload.
  var VALID_ENTRY_STATES = {
    initial: true, connected: true, offline: true
  };

  function stateSetter(widget, state) {
    return function() {
      if(haveLocalStorage) {
        localStorage[LS_STATE_KEY] = state;
      }
      if(widget.view) {
        if(widget.rs.remote) {
          widget.view.setUserAddress(widget.rs.remote.userAddress);
        }
        widget.view.setState(state, arguments);
      } else {
        widget._rememberedState = state;
      }
    };
  }
  function errorsHandler(widget){
    //decided to not store error state
    return function(error){
      if(error instanceof RemoteStorage.DiscoveryError) {
        console.error('discovery failed',  error, '"' + error.message + '"');
        widget.view.setState('initial', [error.message]);
      } else if(error instanceof RemoteStorage.SyncError) {
        widget.view.setState('offline', []);
      } else if(error instanceof RemoteStorage.Unauthorized){
        widget.view.setState('unauthorized')
      } else {
        widget.view.setState('error', [error]);
      }
    }
  }
  /**
   * Class: RemoteStorage.Widget
   *   the Widget Controler that comunicates with the view 
   *   and listens to it's remoteStorage instance
   *
   *   While listening to the Events emitted by it's remoteStorage
   *   it set's corresponding states of the View.
   *
   *   ready        :  connected
   *   disconnected :  initial
   *   connecting   :  authing
   *   authing      :  authing
   *   sync-busy    :  busy
   *   sync-done    :  connected
   *   error        :  depending on the error initial,offline, unauthorized or error
   **/
  RemoteStorage.Widget = function(remoteStorage) {

    // setting event listeners on rs events to put
    // the widget into corresponding states
    this.rs = remoteStorage;
    this.rs.on('ready', stateSetter(this, 'connected'));
    this.rs.on('disconnected', stateSetter(this, 'initial'));
    this.rs.on('connecting', stateSetter(this, 'authing'));
    this.rs.on('authing', stateSetter(this, 'authing'));
    this.rs.on('sync-busy', stateSetter(this, 'busy'));
    this.rs.on('sync-done', stateSetter(this, 'connected'));
    this.rs.on('error', errorsHandler(this) );
    if(haveLocalStorage) {
      var state = localStorage[LS_STATE_KEY];
      if(state && VALID_ENTRY_STATES[state]) {
        this._rememberedState = state;

        if(state == 'connected' && ! remoteStorage.connected) {
          this._rememberedState = 'initial';
        }
      }
    }
  };

  RemoteStorage.Widget.prototype = {

    /**
    *   Method: display(domID)
    *     displays the widget via the view.display method
    *     returns: this
    **/
    display: function(domID) {
      if(! this.view) {
        this.setView(new RemoteStorage.Widget.View(this.rs));
      }
      this.view.display.apply(this.view, arguments);
      return this;
    },
    
    /**
    *   Method: setView(view)
    *    sets the view and initializes event listeners to
    *    react on widget(widget.view) events
    **/
    setView: function(view) {
      this.view = view;
      this.view.on('connect', function(options) {
        if(typeof(options) == 'string') {
          // options is simply a useraddress
          this.rs.connect(options);
        } else if(options.special) {
          this.rs[options.special].connect(options);
        }
      }.bind(this));
      this.view.on('disconnect', this.rs.disconnect.bind(this.rs));
      if(this.rs.sync) {
        this.view.on('sync', this.rs.sync.bind(this.rs));
      }
      try {
        this.view.on('reset', function(){
          this.rs.on('disconnected', document.location.reload.bind(document.location))
          this.rs.disconnect()
        }.bind(this));
      } catch(e) {
        if(e.message && e.message.match(/Unknown event/)) {
          // ignored. (the 0.7 widget-view interface didn't have a 'reset' event)
        } else {
          throw e;
        }
      }

      if(this._rememberedState) {
        setTimeout(stateSetter(this, this._rememberedState), 0);
        delete this._rememberedState;
      }
    }
  };
  /**
   *  Method: displayWidget(domID)
   *    same as display
   **/
  RemoteStorage.prototype.displayWidget = function(domID) {
    return this.widget.display(domID);
  };

  RemoteStorage.Widget._rs_init = function(remoteStorage) {
    if(! remoteStorage.widget) {
      remoteStorage.widget = new RemoteStorage.Widget(remoteStorage);
    }
  };

  RemoteStorage.Widget._rs_supported = function(remoteStorage) {
    haveLocalStorage = 'localStorage' in window;
    return typeof(document) != 'undefined';
  };

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/view.js **/
(function(window){


  //
  // helper methods
  //
  var cEl = document.createElement.bind(document);
  function gCl(parent, className) {
    return parent.getElementsByClassName(className)[0];
  }
  function gTl(parent, className) {
    return parent.getElementsByTagName(className)[0];
  }

  function removeClass(el, className) {
    return el.classList.remove(className);
  }

  function addClass(el, className) {
    return el.classList.add(className);
  }

  function stop_propagation(event) {
    if(typeof(event.stopPropagation) == 'function') {
      event.stopPropagation();
    } else {
      event.cancelBubble = true;
    }
  }

  /**
   * Class: RemoteStorage.Widget.View
   *
   * The View controles the actual visible widget
   *
   * States:
   *   initial      - not connected
   *   authing      - in auth flow
   *   connected    - connected to remote storage, not syncing at the moment
   *   busy         - connected, syncing at the moment
   *   offline      - connected, but no network connectivity
   *   error        - connected, but sync error happened
   *   unauthorized - connected, but request returned 401
   **/
  RemoteStorage.Widget.View = function(remoteStorage) {
    this.rs = remoteStorage;
    if(typeof(document) === 'undefined') {
      throw "Widget not supported";
    }
    RemoteStorage.eventHandling(this,
                                'connect',
                                'disconnect',
                                'sync',
                                'display',
                                'reset');

    // re-binding the event so they can be called from the window
    for(var event in this.events){
      this.events[event] = this.events[event].bind(this);
    }


    // bubble toggling stuff
    /** 
    *  toggleBubble()
    *    shows the bubble when hidden and the other way around
    **/
    this.toggle_bubble = function(event) {
      if(this.bubble.className.search('rs-hidden') < 0) {
        this.hide_bubble(event);
      } else {
        this.show_bubble(event);
      }
    }.bind(this);
    
    /**
     *  hideBubble()
     *   hides the bubble
     **/
    this.hide_bubble = function(){
      //console.log('hide bubble',this);
      addClass(this.bubble, 'rs-hidden')
      document.body.removeEventListener('click', hide_bubble_on_body_click);
    }.bind(this);

    var hide_bubble_on_body_click = function (event) {
      for(var p = event.target; p != document.body; p = p.parentElement) {
        if(p.id == 'remotestorage-widget') {
          return;
        }
      }
      this.hide_bubble();
    }.bind(this);

    /** 
     * Method: showBubble()
     *   shows the bubble
     **/
    this.show_bubble = function(event){
      //console.log('show bubble',this.bubble,event)
      removeClass(this.bubble, 'rs-hidden');
      if(typeof(event) != 'undefined') {
         stop_propagation(event);
       }
      document.body.addEventListener('click', hide_bubble_on_body_click);
      gTl(this.bubble,'form').userAddress.focus();
    }.bind(this);

     /**
     * Method: display(domID)
     *   draws the widget inside of the dom element with the id domID
     *   returns: the widget div
     **/
    this.display = function(domID) {

      if(typeof this.div !== 'undefined')
        return this.div;

      var element = cEl('div');
      var style = cEl('style');
      style.innerHTML = RemoteStorage.Assets.widgetCss;

      element.id = "remotestorage-widget";

      element.innerHTML = RemoteStorage.Assets.widget;


      element.appendChild(style);
      if(domID) {
        var parent = document.getElementById(domID);
        if(! parent) {
          throw "Failed to find target DOM element with id=\"" + domID + "\"";
        }
        parent.appendChild(element);
      } else {
        document.body.appendChild(element);
      }

      var el;
      //sync button
      el = gCl(element, 'rs-sync');
      gTl(el, 'img').src = RemoteStorage.Assets.syncIcon;
      el.addEventListener('click', this.events.sync);

      //disconnect button
      el = gCl(element, 'rs-disconnect');
      gTl(el, 'img').src = RemoteStorage.Assets.disconnectIcon;
      el.addEventListener('click', this.events.disconnect);


      //get me out of here
      var el = gCl(element, 'remotestorage-reset').addEventListener('click', this.events.reset);
      //connect button
      var cb = gCl(element,'connect');
      gTl(cb, 'img').src = RemoteStorage.Assets.connectIcon;
      cb.addEventListener('click', this.events.connect);


      // input
      this.form = gTl(element, 'form')
      el = this.form.userAddress;
      el.addEventListener('keyup', function(event) {
        if(event.target.value) cb.removeAttribute('disabled');
        else cb.setAttribute('disabled','disabled');
      });
      if(this.userAddress) {
        el.value = this.userAddress;
      }

      //the cube
      el = gCl(element, 'rs-cube');
      el.src = RemoteStorage.Assets.remoteStorageIcon;
      el.addEventListener('click', this.toggle_bubble);
      this.cube = el

      //googledrive and dropbox icons
      el = gCl(element, 'rs-dropbox');
      el.src = RemoteStorage.Assets.dropbox;
      el.addEventListener('click', this.connectDropbox.bind(this) );
      
      el = gCl(element, 'rs-googledrive');
      el.src = RemoteStorage.Assets.googledrive;
      el.addEventListener('click', this.connectGdrive.bind(this));
      
      
      //the bubble
      this.bubble = gCl(element,'rs-bubble');
      // what is the meaning of this hiding the b
      var bubbleDontCatch = { INPUT: true, BUTTON: true, IMG: true };
      this.bubble.addEventListener('click', function(event) {
        if(! bubbleDontCatch[event.target.tagName] && ! (this.div.classList.contains('remotestorage-state-unauthorized') )) {

          this.show_bubble(event);
        };
      }.bind(this))
      this.hide_bubble();

      this.div = element;

      this.states.initial.call(this);
      this.events.display.call(this);
      return this.div;
    };

  }

  RemoteStorage.Widget.View.prototype = {

    connectGdrive: function() {
      this._emit('connect', { special: 'googledrive' });
    },
    connectDropbox: function(){
      this._emit('connect', { special: 'dropbox'});
    },
    
    /**
     * Method: setState(state, args)
     *    calls states[state]
     *    args are the arguments for the
     *    state(errors mostly)
     **/
    setState : function(state, args) {
      RemoteStorage.log('widget.view.setState(',state,',',args,');');
      var s = this.states[state];
      if(typeof(s) === 'undefined') {
        throw new Error("Bad State assigned to view: " + state);
      }
      s.apply(this,args);
    },

    /**
     * Method: setUserAddres
     *    set userAddress of the input field
     **/
    setUserAddress : function(addr) {
      this.userAddress = addr || '';

      var el;
      if(this.div && (el = gTl(this.div, 'form').userAddress)) {
        el.value = this.userAddress;
      }
    },

    states :  {
      initial : function(message) {
        var cube = this.cube;
        var info = message || 'This app allows you to use your own storage! Find more info on <a href="http://remotestorage.io/" target="_blank">remotestorage.io';
        if(message) {
          cube.src = RemoteStorage.Assets.remoteStorageIconError;
          removeClass(this.cube, 'remotestorage-loading');
          this.show_bubble();
          setTimeout(function(){
            cube.src = RemoteStorage.Assets.remoteStorageIcon;
          },5000)//show the red error cube for 5 seconds, then show the normal orange one again
        } else {
          this.hide_bubble();
        }
        this.div.className = "remotestorage-state-initial";
        gCl(this.div, 'rs-status-text').innerHTML = "<strong>Connect</strong> remote storage";

        //googledrive and dropbox icons
        var backends = 1;
        if(! this.rs.apiKeys.dropbox) {
          gCl(this.div,'rs-dropbox').style.display = 'none';
        } else {
          gCl(this.div,'rs-dropbox').style.display = 'inline-block';
          backends += 1
        }
        if(! this.rs.apiKeys.googledrive) {
          gCl(this.div,'rs-googledrive').style.display = 'none';
        } else {
          gCl(this.div,'rs-googledrive').style.display = 'inline-block';
          backends += 1
        }
        gCl(this.div, 'rs-bubble-text').style.paddingRight = backends*32+8+'px'

        //if address not empty connect button enabled
        var cb = gCl(this.div, 'connect');
        if(this.form.userAddress.value)
          cb.removeAttribute('disabled');

        var infoEl = gCl(this.div, 'rs-info-msg');
        infoEl.innerHTML = info;

        if(message) {
          infoEl.classList.add('remotestorage-error-info');
        } else {
          infoEl.classList.remove('remotestorage-error-info');
        }

      },
      authing : function() {
        this.div.removeEventListener('click', this.events.connect);
        this.div.className = "remotestorage-state-authing";
        gCl(this.div, 'rs-status-text').innerHTML = "Connecting <strong>"+this.userAddress+"</strong>";
        addClass(this.cube, 'remotestorage-loading'); //TODO needs to be undone, when is that neccesary
      },
      connected : function() {
        this.div.className = "remotestorage-state-connected";
        gCl(this.div, 'userAddress').innerHTML = this.userAddress;
        this.cube.src = RemoteStorage.Assets.remoteStorageIcon;
        removeClass(this.cube, 'remotestorage-loading');
        var icons = {
          googledrive: gCl(this.div, 'rs-googledrive'),
          dropbox: gCl(this.div, 'rs-dropbox')
        };
        icons.googledrive.style.display = icons.dropbox.style.display = 'none';
        if(icons[this.rs.backend]) {
          icons[this.rs.backend].style.display = 'inline-block';
          gCl(this.div, 'rs-bubble-text').style.paddingRight = 2*32+8+'px'
        } else {
          gCl(this.div, 'rs-bubble-text').style.paddingRight = 32+8+'px'
        }
      },
      busy : function() {
        this.div.className = "remotestorage-state-busy";
        addClass(this.cube, 'remotestorage-loading'); //TODO needs to be undone when is that neccesary
        this.hide_bubble();
      },
      offline : function() {
        this.div.className = "remotestorage-state-offline";
        this.cube.src = RemoteStorage.Assets.remoteStorageIconOffline;
        gCl(this.div, 'rs-status-text').innerHTML = 'Offline';
      },
      error : function(err) {
        var errorMsg = err;
        this.div.className = "remotestorage-state-error";

        gCl(this.div, 'rs-bubble-text').innerHTML = '<strong> Sorry! An error occured.</strong>'
        if(err instanceof Error /*|| err instanceof DOMError*/) { //I don't know what an DOMError is and my browser doesn't know too(how to handle this?)
          errorMsg = err.message + '\n\n' +
            err.stack;
        }
        gCl(this.div, 'rs-error-msg').textContent = errorMsg;
        this.cube.src = RemoteStorage.Assets.remoteStorageIconError;
        this.show_bubble();
      },
      unauthorized : function() {
        this.div.className = "remotestorage-state-unauthorized";
        this.cube.src = RemoteStorage.Assets.remoteStorageIconError;
        this.show_bubble();
        this.div.addEventListener('click', this.events.connect);
      }
    },

    events : {
    /**
     * Event: connect
     * emitted when the connect button is clicked
     **/  
      connect : function(event) {
        stop_propagation(event);
        event.preventDefault();
        this._emit('connect', gTl(this.div, 'form').userAddress.value);
      },


      /**
       * Event: sync
       * emitted when the sync button is clicked
       **/
      sync : function(event) {
        stop_propagation(event);
        event.preventDefault();

        this._emit('sync');
      },

      /**
       * Event: disconnect
       * emitted when the disconnect button is clicked
       **/
      disconnect : function(event) {
        stop_propagation(event);
        event.preventDefault();
        this._emit('disconnect');
      },

      /**
       * Event: reset
       * fired after crash triggers disconnect
       **/
      reset : function(event){
        event.preventDefault();
        var result = window.confirm("Are you sure you want to reset everything? That will probably make the error go away, but also clear your entire localStorage and reload the page. Please make sure you know what you are doing, before clicking 'yes' :-)");
        if(result){
          this._emit('reset');
        }
      },

      /**
       * Event: display
       * fired when finished displaying the widget
       **/  
      display : function(event) {
        if(event)
          event.preventDefault();
        this._emit('display');
      }
    }
  };
})(typeof(window) !== 'undefined' ? window : global);


/** FILE: lib/tv4.js **/
/**
Author: Geraint Luff and others
Year: 2013

This code is released into the "public domain" by its author(s).  Anybody may use, alter and distribute the code without restriction.  The author makes no guarantees, and takes no liability of any kind for use of this code.

If you find a bug or make an improvement, it would be courteous to let the author know, but it is not compulsory.
**/

(function (global) {
var ValidatorContext = function (parent, collectMultiple) {
	this.missing = [];
	this.schemas = parent ? Object.create(parent.schemas) : {};
	this.collectMultiple = collectMultiple;
	this.errors = [];
	this.handleError = collectMultiple ? this.collectError : this.returnError;
};
ValidatorContext.prototype.returnError = function (error) {
	return error;
};
ValidatorContext.prototype.collectError = function (error) {
	if (error) {
		this.errors.push(error);
	}
	return null;
}
ValidatorContext.prototype.prefixErrors = function (startIndex, dataPath, schemaPath) {
	for (var i = startIndex; i < this.errors.length; i++) {
		this.errors[i] = this.errors[i].prefixWith(dataPath, schemaPath);
	}
	return this;
}

ValidatorContext.prototype.getSchema = function (url) {
	if (this.schemas[url] != undefined) {
		var schema = this.schemas[url];
		return schema;
	}
	var baseUrl = url;
	var fragment = "";
	if (url.indexOf('#') != -1) {
		fragment = url.substring(url.indexOf("#") + 1);
		baseUrl = url.substring(0, url.indexOf("#"));
	}
	if (this.schemas[baseUrl] != undefined) {
		var schema = this.schemas[baseUrl];
		var pointerPath = decodeURIComponent(fragment);
		if (pointerPath == "") {
			return schema;
		} else if (pointerPath.charAt(0) != "/") {
			return undefined;
		}
		var parts = pointerPath.split("/").slice(1);
		for (var i = 0; i < parts.length; i++) {
			var component = parts[i].replace("~1", "/").replace("~0", "~");
			if (schema[component] == undefined) {
				schema = undefined;
				break;
			}
			schema = schema[component];
		}
		if (schema != undefined) {
			return schema;
		}
	}
	if (this.missing[baseUrl] == undefined) {
		this.missing.push(baseUrl);
		this.missing[baseUrl] = baseUrl;
	}
};
ValidatorContext.prototype.addSchema = function (url, schema) {
	var map = {};
	map[url] = schema;
	normSchema(schema, url);
	searchForTrustedSchemas(map, schema, url);
	for (var key in map) {
		this.schemas[key] = map[key];
	}
	return map;
};
	
ValidatorContext.prototype.validateAll = function validateAll(data, schema, dataPathParts, schemaPathParts) {
	if (schema['$ref'] != undefined) {
		schema = this.getSchema(schema['$ref']);
		if (!schema) {
			return null;
		}
	}
	
	var errorCount = this.errors.length;
	var error = this.validateBasic(data, schema)
		|| this.validateNumeric(data, schema)
		|| this.validateString(data, schema)
		|| this.validateArray(data, schema)
		|| this.validateObject(data, schema)
		|| this.validateCombinations(data, schema)
		|| null
	if (error || errorCount != this.errors.length) {
		while ((dataPathParts && dataPathParts.length) || (schemaPathParts && schemaPathParts.length)) {
			var dataPart = (dataPathParts && dataPathParts.length) ? "" + dataPathParts.pop() : null;
			var schemaPart = (schemaPathParts && schemaPathParts.length) ? "" + schemaPathParts.pop() : null;
			if (error) {
				error = error.prefixWith(dataPart, schemaPart);
			}
			this.prefixErrors(errorCount, dataPart, schemaPart);
		}
	}
		
	return this.handleError(error);
}

function recursiveCompare(A, B) {
	if (A === B) {
		return true;
	}
	if (typeof A == "object" && typeof B == "object") {
		if (Array.isArray(A) != Array.isArray(B)) {
			return false;
		} else if (Array.isArray(A)) {
			if (A.length != B.length) {
				return false
			}
			for (var i = 0; i < A.length; i++) {
				if (!recursiveCompare(A[i], B[i])) {
					return false;
				}
			}
		} else {
			for (var key in A) {
				if (B[key] === undefined && A[key] !== undefined) {
					return false;
				}
			}
			for (var key in B) {
				if (A[key] === undefined && B[key] !== undefined) {
					return false;
				}
			}
			for (var key in A) {
				if (!recursiveCompare(A[key], B[key])) {
					return false;
				}
			}
		}
		return true;
	}
	return false;
}

ValidatorContext.prototype.validateBasic = function validateBasic(data, schema) {
	var error;
	if (error = this.validateType(data, schema)) {
		return error.prefixWith(null, "type");
	}
	if (error = this.validateEnum(data, schema)) {
		return error.prefixWith(null, "type");
	}
	return null;
}

ValidatorContext.prototype.validateType = function validateType(data, schema) {
	if (schema.type == undefined) {
		return null;
	}
	var dataType = typeof data;
	if (data == null) {
		dataType = "null";
	} else if (Array.isArray(data)) {
		dataType = "array";
	}
	var allowedTypes = schema.type;
	if (typeof allowedTypes != "object") {
		allowedTypes = [allowedTypes];
	}
	
	for (var i = 0; i < allowedTypes.length; i++) {
		var type = allowedTypes[i];
		if (type == dataType || (type == "integer" && dataType == "number" && (data%1 == 0))) {
			return null;
		}
	}
	return new ValidationError(ErrorCodes.INVALID_TYPE, "invalid data type: " + dataType);
}

ValidatorContext.prototype.validateEnum = function validateEnum(data, schema) {
	if (schema["enum"] == undefined) {
		return null;
	}
	for (var i = 0; i < schema["enum"].length; i++) {
		var enumVal = schema["enum"][i];
		if (recursiveCompare(data, enumVal)) {
			return null;
		}
	}
	return new ValidationError(ErrorCodes.ENUM_MISMATCH, "No enum match for: " + JSON.stringify(data));
}
ValidatorContext.prototype.validateNumeric = function validateNumeric(data, schema) {
	return this.validateMultipleOf(data, schema)
		|| this.validateMinMax(data, schema)
		|| null;
}

ValidatorContext.prototype.validateMultipleOf = function validateMultipleOf(data, schema) {
	var multipleOf = schema.multipleOf || schema.divisibleBy;
	if (multipleOf == undefined) {
		return null;
	}
	if (typeof data == "number") {
		if (data%multipleOf != 0) {
			return new ValidationError(ErrorCodes.NUMBER_MULTIPLE_OF, "Value " + data + " is not a multiple of " + multipleOf);
		}
	}
	return null;
}

ValidatorContext.prototype.validateMinMax = function validateMinMax(data, schema) {
	if (typeof data != "number") {
		return null;
	}
	if (schema.minimum != undefined) {
		if (data < schema.minimum) {
			return new ValidationError(ErrorCodes.NUMBER_MINIMUM, "Value " + data + " is less than minimum " + schema.minimum).prefixWith(null, "minimum");
		}
		if (schema.exclusiveMinimum && data == schema.minimum) {
			return new ValidationError(ErrorCodes.NUMBER_MINIMUM_EXCLUSIVE, "Value "+ data + " is equal to exclusive minimum " + schema.minimum).prefixWith(null, "exclusiveMinimum");
		}
	}
	if (schema.maximum != undefined) {
		if (data > schema.maximum) {
			return new ValidationError(ErrorCodes.NUMBER_MAXIMUM, "Value " + data + " is greater than maximum " + schema.maximum).prefixWith(null, "maximum");
		}
		if (schema.exclusiveMaximum && data == schema.maximum) {
			return new ValidationError(ErrorCodes.NUMBER_MAXIMUM_EXCLUSIVE, "Value "+ data + " is equal to exclusive maximum " + schema.maximum).prefixWith(null, "exclusiveMaximum");
		}
	}
	return null;
}
ValidatorContext.prototype.validateString = function validateString(data, schema) {
	return this.validateStringLength(data, schema)
		|| this.validateStringPattern(data, schema)
		|| null;
}

ValidatorContext.prototype.validateStringLength = function validateStringLength(data, schema) {
	if (typeof data != "string") {
		return null;
	}
	if (schema.minLength != undefined) {
		if (data.length < schema.minLength) {
			return new ValidationError(ErrorCodes.STRING_LENGTH_SHORT, "String is too short (" + data.length + " chars), minimum " + schema.minLength).prefixWith(null, "minLength");
		}
	}
	if (schema.maxLength != undefined) {
		if (data.length > schema.maxLength) {
			return new ValidationError(ErrorCodes.STRING_LENGTH_LONG, "String is too long (" + data.length + " chars), maximum " + schema.maxLength).prefixWith(null, "maxLength");
		}
	}
	return null;
}

ValidatorContext.prototype.validateStringPattern = function validateStringPattern(data, schema) {
	if (typeof data != "string" || schema.pattern == undefined) {
		return null;
	}
	var regexp = new RegExp(schema.pattern);
	if (!regexp.test(data)) {
		return new ValidationError(ErrorCodes.STRING_PATTERN, "String does not match pattern").prefixWith(null, "pattern");
	}
	return null;
}
ValidatorContext.prototype.validateArray = function validateArray(data, schema) {
	if (!Array.isArray(data)) {
		return null;
	}
	return this.validateArrayLength(data, schema)
		|| this.validateArrayUniqueItems(data, schema)
		|| this.validateArrayItems(data, schema)
		|| null;
}

ValidatorContext.prototype.validateArrayLength = function validateArrayLength(data, schema) {
	if (schema.minItems != undefined) {
		if (data.length < schema.minItems) {
			var error = (new ValidationError(ErrorCodes.ARRAY_LENGTH_SHORT, "Array is too short (" + data.length + "), minimum " + schema.minItems)).prefixWith(null, "minItems");
			if (this.handleError(error)) {
				return error;
			}
		}
	}
	if (schema.maxItems != undefined) {
		if (data.length > schema.maxItems) {
			var error = (new ValidationError(ErrorCodes.ARRAY_LENGTH_LONG, "Array is too long (" + data.length + " chars), maximum " + schema.maxItems)).prefixWith(null, "maxItems");
			if (this.handleError(error)) {
				return error;
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateArrayUniqueItems = function validateArrayUniqueItems(data, schema) {
	if (schema.uniqueItems) {
		for (var i = 0; i < data.length; i++) {
			for (var j = i + 1; j < data.length; j++) {
				if (recursiveCompare(data[i], data[j])) {
					var error = (new ValidationError(ErrorCodes.ARRAY_UNIQUE, "Array items are not unique (indices " + i + " and " + j + ")")).prefixWith(null, "uniqueItems");
					if (this.handleError(error)) {
						return error;
					}
				}
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateArrayItems = function validateArrayItems(data, schema) {
	if (schema.items == undefined) {
		return null;
	}
	var error;
	if (Array.isArray(schema.items)) {
		for (var i = 0; i < data.length; i++) {
			if (i < schema.items.length) {
				if (error = this.validateAll(data[i], schema.items[i], [i], ["items", i])) {
					return error;
				}
			} else if (schema.additionalItems != undefined) {
				if (typeof schema.additionalItems == "boolean") {
					if (!schema.additionalItems) {
						error = (new ValidationError(ErrorCodes.ARRAY_ADDITIONAL_ITEMS, "Additional items not allowed")).prefixWith("" + i, "additionalItems");
						if (this.handleError(error)) {
							return error;
						}
					}
				} else if (error = this.validateAll(data[i], schema.additionalItems, [i], ["additionalItems"])) {
					return error;
				}
			}
		}
	} else {
		for (var i = 0; i < data.length; i++) {
			if (error = this.validateAll(data[i], schema.items, [i], ["items"])) {
				return error;
			}
		}
	}
	return null;
}
ValidatorContext.prototype.validateObject = function validateObject(data, schema) {
	if (typeof data != "object" || data == null || Array.isArray(data)) {
		return null;
	}
	return this.validateObjectMinMaxProperties(data, schema)
		|| this.validateObjectRequiredProperties(data, schema)
		|| this.validateObjectProperties(data, schema)
		|| this.validateObjectDependencies(data, schema)
		|| null;
}

ValidatorContext.prototype.validateObjectMinMaxProperties = function validateObjectMinMaxProperties(data, schema) {
	var keys = Object.keys(data);
	if (schema.minProperties != undefined) {
		if (keys.length < schema.minProperties) {
			var error = new ValidationError(ErrorCodes.OBJECT_PROPERTIES_MINIMUM, "Too few properties defined (" + keys.length + "), minimum " + schema.minProperties).prefixWith(null, "minProperties");
			if (this.handleError(error)) {
				return error;
			}
		}
	}
	if (schema.maxProperties != undefined) {
		if (keys.length > schema.maxProperties) {
			var error = new ValidationError(ErrorCodes.OBJECT_PROPERTIES_MAXIMUM, "Too many properties defined (" + keys.length + "), maximum " + schema.maxProperties).prefixWith(null, "maxProperties");
			if (this.handleError(error)) {
				return error;
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateObjectRequiredProperties = function validateObjectRequiredProperties(data, schema) {
	if (schema.required != undefined) {
		for (var i = 0; i < schema.required.length; i++) {
			var key = schema.required[i];
			if (data[key] === undefined) {
				var error = new ValidationError(ErrorCodes.OBJECT_REQUIRED, "Missing required property: " + key).prefixWith(null, "" + i).prefixWith(null, "required");
				if (this.handleError(error)) {
					return error;
				}
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateObjectProperties = function validateObjectProperties(data, schema) {
	var error;
	for (var key in data) {
		var foundMatch = false;
		if (schema.properties != undefined && schema.properties[key] != undefined) {
			foundMatch = true;
			if (error = this.validateAll(data[key], schema.properties[key], [key], ["properties", key])) {
				return error;
			}
		}
		if (schema.patternProperties != undefined) {
			for (var patternKey in schema.patternProperties) {
				var regexp = new RegExp(patternKey);
				if (regexp.test(key)) {
					foundMatch = true;
					if (error = this.validateAll(data[key], schema.patternProperties[patternKey], [key], ["patternProperties", patternKey])) {
						return error;
					}
				}
			}
		}
		if (!foundMatch && schema.additionalProperties != undefined) {
			if (typeof schema.additionalProperties == "boolean") {
				if (!schema.additionalProperties) {
					error = new ValidationError(ErrorCodes.OBJECT_ADDITIONAL_PROPERTIES, "Additional properties not allowed").prefixWith(key, "additionalProperties");
					if (this.handleError(error)) {
						return error;
					}
				}
			} else {
				if (error = this.validateAll(data[key], schema.additionalProperties, [key], ["additionalProperties"])) {
					return error;
				}
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateObjectDependencies = function validateObjectDependencies(data, schema) {
	var error;
	if (schema.dependencies != undefined) {
		for (var depKey in schema.dependencies) {
			if (data[depKey] !== undefined) {
				var dep = schema.dependencies[depKey];
				if (typeof dep == "string") {
					if (data[dep] === undefined) {
						error = new ValidationError(ErrorCodes.OBJECT_DEPENDENCY_KEY, "Dependency failed - key must exist: " + dep).prefixWith(null, depKey).prefixWith(null, "dependencies");
						if (this.handleError(error)) {
							return error;
						}
					}
				} else if (Array.isArray(dep)) {
					for (var i = 0; i < dep.length; i++) {
						var requiredKey = dep[i];
						if (data[requiredKey] === undefined) {
							error = new ValidationError(ErrorCodes.OBJECT_DEPENDENCY_KEY, "Dependency failed - key must exist: " + requiredKey).prefixWith(null, "" + i).prefixWith(null, depKey).prefixWith(null, "dependencies");
							if (this.handleError(error)) {
								return error;
							}
						}
					}
				} else {
					if (error = this.validateAll(data, dep, [], ["dependencies", depKey])) {
						return error;
					}
				}
			}
		}
	}
	return null;
}

ValidatorContext.prototype.validateCombinations = function validateCombinations(data, schema) {
	var error;
	return this.validateAllOf(data, schema)
		|| this.validateAnyOf(data, schema)
		|| this.validateOneOf(data, schema)
		|| this.validateNot(data, schema)
		|| null;
}

ValidatorContext.prototype.validateAllOf = function validateAllOf(data, schema) {
	if (schema.allOf == undefined) {
		return null;
	}
	var error;
	for (var i = 0; i < schema.allOf.length; i++) {
		var subSchema = schema.allOf[i];
		if (error = this.validateAll(data, subSchema, [], ["allOf", i])) {
			return error;
		}
	}
	return null;
}

ValidatorContext.prototype.validateAnyOf = function validateAnyOf(data, schema) {
	if (schema.anyOf == undefined) {
		return null;
	}
	var errors = [];
	var startErrorCount = this.errors.length;
	for (var i = 0; i < schema.anyOf.length; i++) {
		var subSchema = schema.anyOf[i];

		var errorCount = this.errors.length;
		var error = this.validateAll(data, subSchema, [], ["anyOf", i]);

		if (error == null && errorCount == this.errors.length) {
			this.errors = this.errors.slice(0, startErrorCount);
			return null;
		}
		if (error) {
			errors.push(error.prefixWith(null, "" + i).prefixWith(null, "anyOf"));
		}
	}
	errors = errors.concat(this.errors.slice(startErrorCount));
	this.errors = this.errors.slice(0, startErrorCount);
	return new ValidationError(ErrorCodes.ANY_OF_MISSING, "Data does not match any schemas from \"anyOf\"", "", "/anyOf", errors);
}

ValidatorContext.prototype.validateOneOf = function validateOneOf(data, schema) {
	if (schema.oneOf == undefined) {
		return null;
	}
	var validIndex = null;
	var errors = [];
	var startErrorCount = this.errors.length;
	for (var i = 0; i < schema.oneOf.length; i++) {
		var subSchema = schema.oneOf[i];
		
		var errorCount = this.errors.length;
		var error = this.validateAll(data, subSchema, [], ["oneOf", i]);
		
		if (error == null && errorCount == this.errors.length) {
			if (validIndex == null) {
				validIndex = i;
			} else {
				this.errors = this.errors.slice(0, startErrorCount);
				return new ValidationError(ErrorCodes.ONE_OF_MULTIPLE, "Data is valid against more than one schema from \"oneOf\": indices " + validIndex + " and " + i, "", "/oneOf");
			}
		} else if (error) {
			errors.push(error.prefixWith(null, "" + i).prefixWith(null, "oneOf"));
		}
	}
	if (validIndex == null) {
		errors = errors.concat(this.errors.slice(startErrorCount));
		this.errors = this.errors.slice(0, startErrorCount);
		return new ValidationError(ErrorCodes.ONE_OF_MISSING, "Data does not match any schemas from \"oneOf\"", "", "/oneOf", errors);
	} else {
		this.errors = this.errors.slice(0, startErrorCount);
	}
	return null;
}

ValidatorContext.prototype.validateNot = function validateNot(data, schema) {
	if (schema.not == undefined) {
		return null;
	}
	var oldErrorCount = this.errors.length;
	var error = this.validateAll(data, schema.not);
	var notErrors = this.errors.slice(oldErrorCount);
	this.errors = this.errors.slice(0, oldErrorCount);
	if (error == null && notErrors.length == 0) {
		return new ValidationError(ErrorCodes.NOT_PASSED, "Data matches schema from \"not\"", "", "/not")
	}
	return null;
}

// parseURI() and resolveUrl() are from https://gist.github.com/1088850
//   -  released as public domain by author ("Yaffle") - see comments on gist

function parseURI(url) {
	var m = String(url).replace(/^\s+|\s+$/g, '').match(/^([^:\/?#]+:)?(\/\/(?:[^:@]*(?::[^:@]*)?@)?(([^:\/?#]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?/);
	// authority = '//' + user + ':' + pass '@' + hostname + ':' port
	return (m ? {
		href     : m[0] || '',
		protocol : m[1] || '',
		authority: m[2] || '',
		host     : m[3] || '',
		hostname : m[4] || '',
		port     : m[5] || '',
		pathname : m[6] || '',
		search   : m[7] || '',
		hash     : m[8] || ''
	} : null);
}

function resolveUrl(base, href) {// RFC 3986

	function removeDotSegments(input) {
		var output = [];
		input.replace(/^(\.\.?(\/|$))+/, '')
			.replace(/\/(\.(\/|$))+/g, '/')
			.replace(/\/\.\.$/, '/../')
			.replace(/\/?[^\/]*/g, function (p) {
				if (p === '/..') {
					output.pop();
				} else {
					output.push(p);
				}
		});
		return output.join('').replace(/^\//, input.charAt(0) === '/' ? '/' : '');
	}

	href = parseURI(href || '');
	base = parseURI(base || '');

	return !href || !base ? null : (href.protocol || base.protocol) +
		(href.protocol || href.authority ? href.authority : base.authority) +
		removeDotSegments(href.protocol || href.authority || href.pathname.charAt(0) === '/' ? href.pathname : (href.pathname ? ((base.authority && !base.pathname ? '/' : '') + base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1) + href.pathname) : base.pathname)) +
		(href.protocol || href.authority || href.pathname ? href.search : (href.search || base.search)) +
		href.hash;
}

function normSchema(schema, baseUri) {
	if (baseUri == undefined) {
		baseUri = schema.id;
	} else if (typeof schema.id == "string") {
		baseUri = resolveUrl(baseUri, schema.id);
		schema.id = baseUri;
	}
	if (typeof schema == "object") {
		if (Array.isArray(schema)) {
			for (var i = 0; i < schema.length; i++) {
				normSchema(schema[i], baseUri);
			}
		} else if (typeof schema['$ref'] == "string") {
			schema['$ref'] = resolveUrl(baseUri, schema['$ref']);
		} else {
			for (var key in schema) {
				if (key != "enum") {
					normSchema(schema[key], baseUri);
				}
			}
		}
	}
}

var ErrorCodes = {
	INVALID_TYPE: 0,
	ENUM_MISMATCH: 1,
	ANY_OF_MISSING: 10,
	ONE_OF_MISSING: 11,
	ONE_OF_MULTIPLE: 12,
	NOT_PASSED: 13,
	// Numeric errors
	NUMBER_MULTIPLE_OF: 100,
	NUMBER_MINIMUM: 101,
	NUMBER_MINIMUM_EXCLUSIVE: 102,
	NUMBER_MAXIMUM: 103,
	NUMBER_MAXIMUM_EXCLUSIVE: 104,
	// String errors
	STRING_LENGTH_SHORT: 200,
	STRING_LENGTH_LONG: 201,
	STRING_PATTERN: 202,
	// Object errors
	OBJECT_PROPERTIES_MINIMUM: 300,
	OBJECT_PROPERTIES_MAXIMUM: 301,
	OBJECT_REQUIRED: 302,
	OBJECT_ADDITIONAL_PROPERTIES: 303,
	OBJECT_DEPENDENCY_KEY: 304,
	// Array errors
	ARRAY_LENGTH_SHORT: 400,
	ARRAY_LENGTH_LONG: 401,
	ARRAY_UNIQUE: 402,
	ARRAY_ADDITIONAL_ITEMS: 403
};

function ValidationError(code, message, dataPath, schemaPath, subErrors) {
	if (code == undefined) {
		throw new Error ("No code supplied for error: "+ message);
	}
	this.code = code;
	this.message = message;
	this.dataPath = dataPath ? dataPath : "";
	this.schemaPath = schemaPath ? schemaPath : "";
	this.subErrors = subErrors ? subErrors : null;
}
ValidationError.prototype = {
	prefixWith: function (dataPrefix, schemaPrefix) {
		if (dataPrefix != null) {
			dataPrefix = dataPrefix.replace("~", "~0").replace("/", "~1");
			this.dataPath = "/" + dataPrefix + this.dataPath;
		}
		if (schemaPrefix != null) {
			schemaPrefix = schemaPrefix.replace("~", "~0").replace("/", "~1");
			this.schemaPath = "/" + schemaPrefix + this.schemaPath;
		}
		if (this.subErrors != null) {
			for (var i = 0; i < this.subErrors.length; i++) {
				this.subErrors[i].prefixWith(dataPrefix, schemaPrefix);
			}
		}
		return this;
	}
};

function searchForTrustedSchemas(map, schema, url) {
	if (typeof schema.id == "string") {
		if (schema.id.substring(0, url.length) == url) {
			var remainder = schema.id.substring(url.length);
			if ((url.length > 0 && url.charAt(url.length - 1) == "/")
				|| remainder.charAt(0) == "#"
				|| remainder.charAt(0) == "?") {
				if (map[schema.id] == undefined) {
					map[schema.id] = schema;
				}
			}
		}
	}
	if (typeof schema == "object") {
		for (var key in schema) {
			if (key != "enum" && typeof schema[key] == "object") {
				searchForTrustedSchemas(map, schema[key], url);
			}
		}
	}
	return map;
}

var globalContext = new ValidatorContext();

var publicApi = {
	validate: function (data, schema) {
		var context = new ValidatorContext(globalContext);
		if (typeof schema == "string") {
			schema = {"$ref": schema};
		}
		var added = context.addSchema("", schema);
		var error = context.validateAll(data, schema);
		this.error = error;
		this.missing = context.missing;
		this.valid = (error == null);
		return this.valid;
	},
	validateResult: function () {
		var result = {};
		this.validate.apply(result, arguments);
		return result;
	},
	validateMultiple: function (data, schema) {
		var context = new ValidatorContext(globalContext, true);
		if (typeof schema == "string") {
			schema = {"$ref": schema};
		}
		context.addSchema("", schema);
		context.validateAll(data, schema);
		var result = {};
		result.errors = context.errors;
		result.missing = context.missing;
		result.valid = (result.errors.length == 0);
		return result;
	},
	addSchema: function (url, schema) {
		return globalContext.addSchema(url, schema);
	},
	getSchema: function (url) {
		return globalContext.getSchema(url);
	},
	missing: [],
	error: null,
	normSchema: normSchema,
	resolveUrl: resolveUrl,
	errorCodes: ErrorCodes
};

global.tv4 = publicApi;

})(typeof(window) != 'undefined' ? window : global);



/** FILE: lib/Math.uuid.js **/
/*!
  Math.uuid.js (v1.4)
  http://www.broofa.com
  mailto:robert@broofa.com

  Copyright (c) 2010 Robert Kieffer
  Dual licensed under the MIT and GPL licenses.

  ********

  Changes within remoteStorage.js:
  2012-10-31:
  - added AMD wrapper <niklas@unhosted.org>
  - moved extensions for Math object into exported object.
*/

/*
 * Generate a random uuid.
 *
 * USAGE: Math.uuid(length, radix)
 *   length - the desired number of characters
 *   radix  - the number of allowable values for each character.
 *
 * EXAMPLES:
 *   // No arguments  - returns RFC4122, version 4 ID
 *   >>> Math.uuid()
 *   "92329D39-6F5C-4520-ABFC-AAB64544E172"
 *
 *   // One argument - returns ID of the specified length
 *   >>> Math.uuid(15)     // 15 character ID (default base=62)
 *   "VcydxgltxrVZSTV"
 *
 *   // Two arguments - returns ID of the specified length, and radix. (Radix must be <= 62)
 *   >>> Math.uuid(8, 2)  // 8 character ID (base=2)
 *   "01001010"
 *   >>> Math.uuid(8, 10) // 8 character ID (base=10)
 *   "47473046"
 *   >>> Math.uuid(8, 16) // 8 character ID (base=16)
 *   "098F4D35"
 */
  // Private array of chars to use
  var CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

Math.uuid = function (len, radix) {
  var chars = CHARS, uuid = [], i;
  radix = radix || chars.length;

  if (len) {
    // Compact form
    for (i = 0; i < len; i++) uuid[i] = chars[0 | Math.random()*radix];
  } else {
    // rfc4122, version 4 form
    var r;

    // rfc4122 requires these characters
    uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
    uuid[14] = '4';

    // Fill in random data.  At i==19 set the high bits of clock sequence as
    // per rfc4122, sec. 4.1.5
    for (i = 0; i < 36; i++) {
      if (!uuid[i]) {
        r = 0 | Math.random()*16;
        uuid[i] = chars[(i == 19) ? (r & 0x3) | 0x8 : r];
      }
    }
  }

  return uuid.join('');
};


/** FILE: src/baseclient.js **/

(function(global) {

  function deprecate(thing, replacement) {
    console.log('WARNING: ' + thing + ' is deprecated. Use ' +
                replacement + ' instead.');
  }

  var RS = RemoteStorage;

  /**
   * Class: RemoteStorage.BaseClient
   *
   * Provides a high-level interface to access data below a given root path.
   *
   * A BaseClient deals with three types of data: folders, objects and files.
   *
   * <getListing> returns a list of all items within a folder, or undefined
   * if a 404 is encountered. Items that end with a forward slash ("/") are
   * child folders.
   *
   * <getObject> / <storeObject> operate on JSON objects. Each object has a type.
   *
   * <getFile> / <storeFile> operates on files. Each file has a MIME type.
   *
   * <remove> operates on either objects or files (but not folders, folders are
   * created and removed implictly).
   */
  RS.BaseClient = function(storage, base) {
    if(base[base.length - 1] != '/') {
      throw "Not a directory: " + base;
    }

    if(base == '/') {
      // allow absolute and relative paths for the root scope.
      this.makePath = function(path) {
        return (path[0] == '/' ? '' : '/') + path;
      }
    }

    /**
     * Property: storage
     *
     * The <RemoteStorage> instance this <BaseClient> operates on.
     */
    this.storage = storage;
    /**
     * Property: base
     *
     * Base path this <BaseClient> operates on.
     *
     * For the module's privateClient this would be /<moduleName>/, for the
     * corresponding publicClient /public/<moduleName>/.
     */
    this.base = base;

    var parts = this.base.split('/');
    if(parts.length > 2) {
      this.moduleName = parts[1];
    } else {
      this.moduleName = 'root';
    }
    /**
     * Event: change
     * emitted when a node changes
     *
     * Arguments: event 
     * (start code)
     * {
     *    path: path,
     *    origin: incoming ? 'remote' : 'window',
     *    oldValue: oldBody,
     *    newValue: newBody
     *  }
     * (end code)
     *
     * * the path ofcourse is the path of the node that changed
     *
     *
     * * the origin tells you if it's an change pulled by sync(remote)
     * or some user action within the app(window)
     *
     *
     * 
     * * the oldValue defaults to undefined if you are dealing with some
     * new file
     *
     *
     * * the newValue defaults to undefined if you are dealing with a deletion
     * 
     * * when newValue and oldValue are set you are dealing with an update
     **/
    /**
     * Event: conflict
     *
     **/

    RS.eventHandling(this, 'change', 'conflict');
    this.on = this.on.bind(this);
    storage.onChange(this.base, this._fireChange.bind(this));
    storage.onConflict(this.base, this._fireConflict.bind(this));
  };

  RS.BaseClient.prototype = {

    // BEGIN LEGACY
    use: function(path) {
      deprecate('BaseClient#use(path)', 'BaseClient#cache(path)');
      return this.cache(path);
    },

    release: function(path) {
      deprecate('BaseClient#release(path)', 'BaseClient#cache(path, false)');
      return this.cache(path, false);
    },
    // END LEGACY

    extend: function(object) {
      for(var key in object) {
        this[key] = object[key];
      }
      return this;
    },

    /**
     * Method: scope
     *
     * Returns a new <BaseClient> operating on a subpath of the current <base> path.
     */
    scope: function(path) {
      return new RS.BaseClient(this.storage, this.makePath(path));
    },

    // folder operations

    /**
     * Method: getListing
     *
     * Get a list of child nodes below a given path.
     *
     * The callback semantics of getListing are identical to those of getObject.
     *
     * Parameters:
     *   path     - The path to query. It MUST end with a forward slash.
     *
     * Returns:
     *   A promise for an Array of keys, representing child nodes.
     *   Those keys ending in a forward slash, represent *directory nodes*, all
     *   other keys represent *data nodes*.
     *
     * Example:
     *   (start code)
     *   client.getListing('').then(function(listing) {
     *     listing.forEach(function(item) {
     *       console.log('- ' + item);
     *     });
     *   });
     *   (end code)
     */
    getListing: function(path) {
      if(typeof(path) == 'undefined') {
        path = '';
      } else if(path.length > 0 && path[path.length - 1] != '/') {
        throw "Not a directory: " + path;
      }
      return this.storage.get(this.makePath(path)).then(function(status, body) {
        if(status == 404) return;
        return typeof(body) === 'object' ? Object.keys(body) : undefined;
      });
    },

    /**
     * Method: getAll
     *
     * Get all objects directly below a given path.
     *
     * Parameters:
     *   path      - path to the direcotry
     *   typeAlias - (optional) local type-alias to filter for
     *
     * Returns:
     *   a promise for an object in the form { path : object, ... }
     *
     * Example:
     *   (start code)
     *   client.getAll('').then(function(objects) {
     *     for(var key in objects) {
     *       console.log('- ' + key + ': ', objects[key]);
     *     }
     *   });
     *   (end code)
     */
    getAll: function(path) {
      if(typeof(path) == 'undefined') {
        path = '';
      } else if(path.length > 0 && path[path.length - 1] != '/') {
        throw "Not a directory: " + path;
      }
      return this.storage.get(this.makePath(path)).then(function(status, body) {
        if(status == 404) return;
        if(typeof(body) === 'object') {
          var promise = promising();
          var count = Object.keys(body).length, i = 0;
          if(count == 0) {
            // treat this like 404. it probably means a directory listing that
            // has changes that haven't been pushed out yet.
            return;
          }
          for(var key in body) {
            this.storage.get(this.makePath(path + key)).
              then(function(status, b) {
                body[this.key] = b;
                i++;
                if(i == count) promise.fulfill(body);
              }.bind({ key: key }));
          }
          return promise;
        }
      }.bind(this));
    },

    // file operations

    /**
     * Method: getFile
     *
     * Get the file at the given path. A file is raw data, as opposed to
     * a JSON object (use <getObject> for that).
     *
     * Except for the return value structure, getFile works exactly like
     * getObject.
     *
     * Parameters:
     *   path     - see getObject
     *
     * Returns:
     *   A promise for an object:
     *
     *   mimeType - String representing the MIME Type of the document.
     *   data     - Raw data of the document (either a string or an ArrayBuffer)
     *
     * Example:
     *   (start code)
     *   // Display an image:
     *   client.getFile('path/to/some/image').then(function(file) {
     *     var blob = new Blob([file.data], { type: file.mimeType });
     *     var targetElement = document.findElementById('my-image-element');
     *     targetElement.src = window.URL.createObjectURL(blob);
     *   });
     *   (end code)
     */
    getFile: function(path) {
      return this.storage.get(this.makePath(path)).then(function(status, body, mimeType, revision) {
        return {
          data: body,
          mimeType: mimeType,
          revision: revision // (this is new)
        };
      });
    },

    /**
     * Method: storeFile
     *
     * Store raw data at a given path.
     *
     * Parameters:
     *   mimeType - MIME media type of the data being stored
     *   path     - path relative to the module root. MAY NOT end in a forward slash.
     *   data     - string, ArrayBuffer or ArrayBufferView of raw data to store
     *
     * The given mimeType will later be returned, when retrieving the data
     * using <getFile>.
     *
     * Example (UTF-8 data):
     *   (start code)
     *   client.storeFile('text/html', 'index.html', '<h1>Hello World!</h1>');
     *   (end code)
     *
     * Example (Binary data):
     *   (start code)
     *   // MARKUP:
     *   <input type="file" id="file-input">
     *   // CODE:
     *   var input = document.getElementById('file-input');
     *   var file = input.files[0];
     *   var fileReader = new FileReader();
     *
     *   fileReader.onload = function() {
     *     client.storeFile(file.type, file.name, fileReader.result);
     *   };
     *
     *   fileReader.readAsArrayBuffer(file);
     *   (end code)
     *
     */
    storeFile: function(mimeType, path, body) {
      var self = this;
      return this.storage.put(this.makePath(path), body, mimeType).then(function(status, _body, _mimeType, revision) {
        if(status == 200 || status == 201) {
          return revision;
        } else {
          throw "Request (PUT " + self.makePath(path) + ") failed with status: " + status;
        }
      });
    },

    // object operations

    /**
     * Method: getObject
     *
     * Get a JSON object from given path.
     *
     * Parameters:
     *   path     - relative path from the module root (without leading slash)
     *
     * Returns:
     *   A promise for the object.
     *
     * Example:
     *   (start code)
     *   client.getObject('/path/to/object').
     *     then(function(object) {
     *       // object is either an object or null
     *     });
     *   (end code)
     */
    getObject: function(path) {
      return this.storage.get(this.makePath(path)).then(function(status, body, mimeType, revision) {
        if(typeof(body) == 'object') {
          return body;
        } else if(typeof(body) !== 'undefined' && status == 200) {
          throw "Not an object: " + this.makePath(path);
        }
      });
    },

    /**
     * Method: storeObject
     *
     * Store object at given path. Triggers synchronization.
     *
     * Parameters:
     *
     *   type     - unique type of this object within this module. See description below.
     *   path     - path relative to the module root.
     *   object   - an object to be saved to the given node. It must be serializable as JSON.
     *
     * Returns:
     *   A promise to store the object. The promise fails with a ValidationError, when validations fail.
     *
     *
     * What about the type?:
     *
     *   A great thing about having data on the web, is to be able to link to
     *   it and rearrange it to fit the current circumstances. To facilitate
     *   that, eventually you need to know how the data at hand is structured.
     *   For documents on the web, this is usually done via a MIME type. The
     *   MIME type of JSON objects however, is always application/json.
     *   To add that extra layer of "knowing what this object is", remoteStorage
     *   aims to use <JSON-LD at http://json-ld.org/>.
     *   A first step in that direction, is to add a *@context attribute* to all
     *   JSON data put into remoteStorage.
     *   Now that is what the *type* is for.
     *
     *   Within remoteStorage.js, @context values are built using three components:
     *     http://remotestoragejs.com/spec/modules/ - A prefix to guarantee unqiueness
     *     the module name     - module names should be unique as well
     *     the type given here - naming this particular kind of object within this module
     *
     *   In retrospect that means, that whenever you introduce a new "type" in calls to
     *   storeObject, you should make sure that once your code is in the wild, future
     *   versions of the code are compatible with the same JSON structure.
     *
     * How to define types?:
     *
     *   See <declareType> for examples.
     */
    storeObject: function(typeAlias, path, object) {
      this._attachType(object, typeAlias);
      try {
        var validationResult = this.validate(object);
        if(! validationResult.valid) {
          return promising(function(p) { p.reject(validationResult); });
        }
      } catch(exc) {
        if(exc instanceof RS.BaseClient.Types.SchemaNotFound) {
          // ignore.
        } else {
          return promising().reject(exc);
        }
      }
      return this.storage.put(this.makePath(path), object, 'application/json; charset=UTF-8').then(function(status, _body, _mimeType, revision) {
        if(status == 200 || status == 201) {
          return revision;
        } else {
          throw "Request (PUT " + this.makePath(path) + ") failed with status: " + status;
        }
      }.bind(this));
    },

    // generic operations

    /**
     * Method: remove
     *
     * Remove node at given path from storage. Triggers synchronization.
     *
     * Parameters:
     *   path     - Path relative to the module root.
     */
    remove: function(path) {
      return this.storage.delete(this.makePath(path));
    },

    cache: function(path, disable) {
      this.storage.caching[disable !== false ? 'enable' : 'disable'](
        this.makePath(path)
      );
      return this;
    },

    makePath: function(path) {
      return this.base + (path || '');
    },

    _fireChange: function(event) {
      this._emit('change', event);
    },

    _fireConflict: function(event) {
      if(this._handlers.conflict.length > 0) {
        this._emit('conflict', event);
      } else {
        event.resolve('remote');
      }
    },

    _cleanPath: RS.WireClient.cleanPath,

    /**
     * Method: getItemURL
     *
     * Retrieve full URL of item
     *
     * Parameters:
     *   path     - Path relative to the module root.
     */
    getItemURL: function(path) {
      if (this.storage.connected) {
        path = this._cleanPath( this.makePath(path) );
        return this.storage.remote.href + path;
      } else {
        return undefined;
      }
    },

    uuid: function() {
      return Math.uuid();
    }

  };

  /**
   * Method: RS#scope
   *
   * Returns a new <RS.BaseClient> scoped to the given path.
   *
   * Parameters:
   *   path - Root path of new BaseClient.
   *
   *
   * Example:
   *   (start code)
   *
   *   var foo = remoteStorage.scope('/foo/');
   *
   *   // PUTs data "baz" to path /foo/bar
   *   foo.storeFile('text/plain', 'bar', 'baz');
   *
   *   var something = foo.scope('something/');
   *
   *   // GETs listing from path /foo/something/bla/
   *   something.getListing('bla/');
   *
   *   (end code)
   *
   */


  RS.BaseClient._rs_init = function() {
    RS.prototype.scope = function(path) {
      return new RS.BaseClient(this, path);
    };
  };

  /* e.g.:
  remoteStorage.defineModule('locations', function(priv, pub) {
    return {
      exports: {
        features: priv.scope('features/').defaultType('feature'),
        collections: priv.scope('collections/').defaultType('feature-collection');
      }
    };
  });
  */

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/baseclient/types.js **/

(function(global) {

  RemoteStorage.BaseClient.Types = {
    // <alias> -> <uri>
    uris: {},
    // <uri> -> <schema>
    schemas: {},
    // <uri> -> <alias>
    aliases: {},

    declare: function(moduleName, alias, uri, schema) {
      var fullAlias = moduleName + '/' + alias;

      if (schema.extends) {
        var extendedAlias;
        var parts = schema.extends.split('/');
        if(parts.length === 1) {
          extendedAlias = moduleName + '/' + parts.shift();
        } else {
          extendedAlias = parts.join('/');
        }
        var extendedUri = this.uris[extendedAlias];
        if(! extendedUri) {
          throw "Type '" + fullAlias + "' tries to extend unknown schema '" + extendedAlias + "'";
        }
        schema.extends = this.schemas[extendedUri];
      }

      this.uris[fullAlias] = uri;
      this.aliases[uri] = fullAlias;
      this.schemas[uri] = schema;
    },

    resolveAlias: function(alias) {
      return this.uris[alias];
    },

    getSchema: function(uri) {
      return this.schemas[uri];
    },

    inScope: function(moduleName) {
      var ml = moduleName.length;
      var schemas = {};
      for(var alias in this.uris) {
        if(alias.substr(0, ml + 1) == moduleName + '/') {
          var uri = this.uris[alias];
          schemas[uri] = this.schemas[uri];
        }
      }
      return schemas;
    }
  };

  var SchemaNotFound = function(uri) {
    var error = Error("Schema not found: " + uri);
    error.name = "SchemaNotFound";
    return error;
  };
  SchemaNotFound.prototype = Error.prototype;

  RemoteStorage.BaseClient.Types.SchemaNotFound = SchemaNotFound;

  RemoteStorage.BaseClient.prototype.extend({

    validate: function(object) {
      var schema = RemoteStorage.BaseClient.Types.getSchema(object['@context']);
      if(schema) {
        return tv4.validateResult(object, schema);
      } else {
        throw new SchemaNotFound(object['@context']);
      }
    },

    // client.declareType(alias, schema);
    //  /* OR */
    // client.declareType(alias, uri, schema);
    declareType: function(alias, uri, schema) {
      if(! schema) {
        schema = uri;
        uri = this._defaultTypeURI(alias);
      }
      RemoteStorage.BaseClient.Types.declare(this.moduleName, alias, uri, schema);
    },

    _defaultTypeURI: function(alias) {
      return 'http://remotestoragejs.com/spec/modules/' + this.moduleName + '/' + alias;
    },

    _attachType: function(object, alias) {
      object['@context'] = RemoteStorage.BaseClient.Types.resolveAlias(alias) || this._defaultTypeURI(alias);
    }
  });

  Object.defineProperty(RemoteStorage.BaseClient.prototype, 'schemas', {
    configurable: true,
    get: function() {
      return RemoteStorage.BaseClient.Types.inScope(this.moduleName);
    }
  });

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/caching.js **/
(function(global) {

  var haveLocalStorage = 'localStorage' in global;
  var SETTINGS_KEY = "remotestorage:caching";

  function containingDir(path) {
    if(path === '') return '/';
    if(! path) throw "Path not given!";
    return path.replace(/\/+/g, '/').replace(/[^\/]+\/?$/, '');
  }

  function isDir(path) {
    return path.substr(-1) == '/';
  }

  function pathContains(a, b) {
    return a.slice(0, b.length) === b;
  }

  /**
   * Class: RemoteStorage.Caching
   *
   * Holds caching configuration.
   */
  RemoteStorage.Caching = function() {
    this.reset();

    if(haveLocalStorage) {
      var settings = localStorage[SETTINGS_KEY];
      if(settings) {
        this._pathSettingsMap = JSON.parse(settings);
        this._updateRoots();
      }
    }
  };

  RemoteStorage.Caching.prototype = {

    /**
     * Method: enable
     *
     * Enable caching for the given path.
     *
     * Parameters:
     *   path - Absolute path to a directory.
     */
    enable: function(path) { this.set(path, { data: true }); },
    /**
     * Method: disable
     *
     * Disable caching for the given path.
     *
     * Parameters:
     *   path - Absolute path to a directory.
     */
    disable: function(path) { this.remove(path); },

    /**
     ** configuration methods
     **/

    get: function(path) {
      this._validateDirPath(path);
      return this._pathSettingsMap[path];
    },

    set: function(path, settings) {
      this._validateDirPath(path);
      if(typeof(settings) !== 'object') {
        throw new Error("settings is required");
      }
      this._pathSettingsMap[path] = settings;
      this._updateRoots();
    },

    remove: function(path) {
      this._validateDirPath(path);
      delete this._pathSettingsMap[path];
      this._updateRoots();
    },

    reset: function() {
      this.rootPaths = [];
      this._pathSettingsMap = {};
    },

    /**
     ** query methods
     **/

    // Method: descendIntoPath
    //
    // Checks if the given directory path should be followed.
    //
    // Returns: true or false
    descendIntoPath: function(path) {
      this._validateDirPath(path);
      return !! this._query(path);
    },

    // Method: cachePath
    //
    // Checks if given path should be cached.
    //
    // Returns: true or false
    cachePath: function(path) {
      this._validatePath(path);
      var settings = this._query(path);
      return settings && (isDir(path) || settings.data);
    },

    /**
     ** private methods
     **/

    // gets settings for given path. walks up the path until it finds something.
    _query: function(path) {
      return this._pathSettingsMap[path] ||
        path !== '/' &&
        this._query(containingDir(path));
    },

    _validatePath: function(path) {
      if(typeof(path) !== 'string') {
        throw new Error("path is required");
      }
    },

    _validateDirPath: function(path) {
      this._validatePath(path);
      if(! isDir(path)) {
        throw new Error("not a directory path: " + path);
      }
      if(path[0] !== '/') {
        throw new Error("path not absolute: " + path);
      }
    },

    _updateRoots: function() {
      var roots = {}
      for(var a in this._pathSettingsMap) {
        // already a root
        if(roots[a]) {
          continue;
        }
        var added = false;
        for(var b in this._pathSettingsMap) {
          if(pathContains(a, b)) {
            roots[b] = true;
            added = true;
            break;
          }
        }
        if(! added) {
          roots[a] = true;
        }
      }
      this.rootPaths = Object.keys(roots);
      if(haveLocalStorage) {
        localStorage[SETTINGS_KEY] = JSON.stringify(this._pathSettingsMap);
      }
    },

  };

  Object.defineProperty(RemoteStorage.Caching.prototype, 'list', {
    get: function() {
      var list = [];
      for(var path in this._pathSettingsMap) {
        list.push({ path: path, settings: this._pathSettingsMap[path] });
      }
      return list;
    }
  });


  Object.defineProperty(RemoteStorage.prototype, 'caching', {
    configurable: true,
    get: function() {
      var caching = new RemoteStorage.Caching();
      Object.defineProperty(this, 'caching', {
        value: caching
      });
      return caching;
    }
  });

  RemoteStorage.Caching._rs_init = function() {};

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/sync.js **/
(function(global) {

  var SYNC_INTERVAL = 10000;
  
  //
  // The synchronization algorithm is as follows:
  //
  // (for each path in caching.rootPaths)
  //
  // (1) Fetch all pending changes from 'local'
  // (2) Try to push pending changes to 'remote', if that fails mark a
  //     conflict, otherwise clear the change.
  // (3) Folder items: GET a listing
  //     File items: GET the file
  // (4) Compare versions. If they match the locally cached one, return.
  //     Otherwise continue.
  // (5) Folder items: For each child item, run this algorithm starting at (3).
  //     File items: Fetch remote data and replace locally cached copy.
  //
  // Depending on the API version the server supports, the version comparison
  // can either happen on the server (through ETag, If-Match, If-None-Match
  // headers), or on the client (through versions specified in the parent listing).
  //

  function isDir(path) {
    return path[path.length - 1] == '/';
  }

  function descendInto(remote, local, path, keys, promise) {
    var n = keys.length, i = 0;
    if(n == 0) promise.fulfill();
    function oneDone() {
      i++;
      if(i == n) promise.fulfill();
    }
    keys.forEach(function(key) {
      synchronize(remote, local, path + key).then(oneDone);
    });
  }

  function updateLocal(remote, local, path, body, contentType, revision, promise) {
    if(isDir(path)) {
      descendInto(remote, local, path, Object.keys(body), promise);
    } else {
      local.put(path, body, contentType, true, revision).then(function() {
        return local.setRevision(path, revision)
      }).then(function() {
        promise.fulfill();
      });
    }
  }

  function allDifferentKeys(a, b) {
    var keyObject = {};
    for(var ak in a) {
      if(a[ak] != b[ak]) {
        keyObject[ak] = true;
      }
    }
    for(var bk in b) {
      if(a[bk] != b[bk]) {
        keyObject[bk] = true;
      }
    }
    return Object.keys(keyObject);
  }
  function promiseDeleteLocal(local, path) {
    var promise = promising();
    deleteLocal(local, path, promise);
    return promise;
  }
  function deleteLocal(local, path, promise) {
    if(isDir(path)) {
      local.get(path).then(function(localStatus, localBody, localContentType, localRevision) {
        var keys = [], failed = false;
        for(item in localBody) {
          keys.push(item);
        }
        //console.log('deleting keys', keys, 'from', path, localBody);
        var n = keys.length, i = 0;
        if(n == 0) promise.fulfill();
        function oneDone() {
          i++;
          if(i == n && !failed) promise.fulfill();
        }
        function oneFailed(error) {
          if(!failed) {
            failed = true;
            promise.reject(error);
          }
        }
        keys.forEach(function(key) {
          promiseDeleteLocal(local, path + key).then(oneDone, oneFailed);
        });
      });
    } else {
      //console.log('deleting local item', path);
      local.delete(path, true).then(promise.fulfill, promise.reject);
    }
  }
 
  function synchronize(remote, local, path, options) {
    var promise = promising();
    local.get(path).then(function(localStatus, localBody, localContentType, localRevision) {
      remote.get(path, {
        ifNoneMatch: localRevision
      }).then(function(remoteStatus, remoteBody, remoteContentType, remoteRevision) {
        if(remoteStatus == 401 || remoteStatus == 403) {
          throw new RemoteStorage.Unauthorized();
        } else if(remoteStatus == 412 || remoteStatus == 304) {
          // up to date.
          promise.fulfill();
        } else if(localStatus == 404 && remoteStatus == 200) {
          // local doesn't exist, remote does.
          updateLocal(remote, local, path, remoteBody, remoteContentType, remoteRevision, promise);
        } else if(localStatus == 200 && remoteStatus == 404) {
          // remote doesn't exist, local does.
          deleteLocal(local, path, promise);
        } else if(localStatus == 200 && remoteStatus == 200) {
          if(isDir(path)) {
            if(remoteRevision && remoteRevision == localRevision) {
              promise.fulfill();
            } else {
              local.setRevision(path, remoteRevision).then(function() {
                descendInto(remote, local, path, allDifferentKeys(localBody, remoteBody), promise);
              });
            }
          } else {
            updateLocal(remote, local, path, remoteBody, remoteContentType, remoteRevision, promise);
          }
        } else {
          // do nothing.
          promise.fulfill();
        }
      }).then(undefined, promise.reject);
    }).then(undefined, promise.reject);
    return promise;
  }

  function fireConflict(local, path, attributes) {
    local.setConflict(path, attributes);
  }

  function pushChanges(remote, local, path) {
    return local.changesBelow(path).then(function(changes) {
      var n = changes.length, i = 0;
      var promise = promising();
      function oneDone(path) {
        function done() {
          i++;
          if(i == n) promise.fulfill();
        }
        if(path) {
          // change was propagated -> clear.
          local.clearChange(path).then(done);
        } else {
          // change wasn't propagated (conflict?) -> handle it later.
          done();
        }
      }
      if(n > 0) {
        function errored(err) {
          console.error("pushChanges aborted due to error: ", err, err.stack);
          promise.reject(err);
        }
        changes.forEach(function(change) {
          if(change.conflict) {
            var res = change.conflict.resolution;
            if(res) {
              RemoteStorage.log('about to resolve', res);
              // ready to be resolved.
              change.action = (res == 'remote' ? change.remoteAction : change.localAction);
              change.force = true;
            } else {
              RemoteStorage.log('conflict pending for ', change.path);
              // pending conflict, won't do anything.
              return oneDone();
            }
          }
          switch(change.action) {
          case 'PUT':
            var options = {};
            if(! change.force) {
              if(change.revision) {
                options.ifMatch = change.revision;
              } else {
                options.ifNoneMatch = '*';
              }
            }
            local.get(change.path).then(function(status, body, contentType) {
              if(status == 200) {
                return remote.put(change.path, body, contentType, options);
              } else {
                return 200; // fake 200 so the change is cleared.
              }
            }).then(function(status) {
              if(status == 412) {
                fireConflict(local, change.path, {
                  localAction: 'PUT',
                  remoteAction: 'PUT'
                });
                oneDone();
              } else {
                oneDone(change.path);
              }
            }).then(undefined, errored);
            break;
          case 'DELETE':
            remote.delete(change.path, {
              ifMatch: change.force ? undefined : change.revision
            }).then(function(status) {
              if(status == 412) {
                fireConflict(local, change.path, {
                  remoteAction: 'PUT',
                  localAction: 'DELETE'
                });
                oneDone();
              } else {
                oneDone(change.path);
              }
            }).then(undefined, errored);
            break;
          }
        });
        return promise;
      }
    });
  }
  /**
   * Class: RemoteStorage.Sync
   **/
  RemoteStorage.Sync = {
    /**
     * Method: sync
     **/
    sync: function(remote, local, path) {
      return pushChanges(remote, local, path).
        then(function() {
          return synchronize(remote, local, path);
        });
    },
    /**
     * Methods: syncTree
     **/
    syncTree: function(remote, local, path) {
      return synchronize(remote, local, path, {
        data: false
      });
    }
  };

  var SyncError = function(originalError) {
    var msg = 'Sync failed: ';
    if(typeof(originalError) == 'object' && 'message' in originalError) {
      msg += originalError.message;
    } else {
      msg += originalError;
    }
    this.originalError = originalError;
    Error.apply(this, [msg]);
  };

  SyncError.prototype = Object.create(Error.prototype);

  RemoteStorage.prototype.sync = function() {
    if(! (this.local && this.caching)) {
      throw "Sync requires 'local' and 'caching'!";
    }
    if(! this.remote.connected) {
      return promising().fulfill();
    }
    var roots = this.caching.rootPaths.slice(0);
    var n = roots.length, i = 0;
    var aborted = false;
    var rs = this;
    return promising(function(promise) {
      if(n == 0) {
        rs._emit('sync-busy');
        rs._emit('sync-done');
        return promise.fulfill();
      }
      rs._emit('sync-busy');
      var path;
      while((path = roots.shift())) {
        (function (path) {
          //console.log('syncing '+path);
          RemoteStorage.Sync.sync(rs.remote, rs.local, path, rs.caching.get(path)).
            then(function() {
              //console.log('syncing '+path+' success');
              if(aborted) return;
              i++;
              if(n == i) {
                rs._emit('sync-done');
                promise.fulfill();
              }
            }, function(error) {
              console.error('syncing', path, 'failed:', error);
              if(aborted) return;
              aborted = true;
              rs._emit('sync-done');
              if(error instanceof RemoteStorage.Unauthorized) {
                rs._emit('error', error);
              } else {
                rs._emit('error', new SyncError(error));
              }
              promise.reject(error);
            });
        })(path);
      }
    });
  };

  RemoteStorage.SyncError = SyncError;

  RemoteStorage.prototype.syncCycle = function() {
    this.sync().then(function() {
      this.stopSync();
      this._syncTimer = setTimeout(this.syncCycle.bind(this), SYNC_INTERVAL);
    }.bind(this),
    function(e) {
      console.log('sync error, retrying');
      this.stopSync();
      this._syncTimer = setTimeout(this.syncCycle.bind(this), SYNC_INTERVAL);
    }.bind(this));
  };

  RemoteStorage.prototype.stopSync = function() {
    if(this._syncTimer) {
      clearTimeout(this._syncTimer);
      delete this._syncTimer;
    }
  };

  RemoteStorage.Sync._rs_init = function(remoteStorage) {
    remoteStorage.on('ready', function() {
      remoteStorage.syncCycle();
    });
  };

  RemoteStorage.Sync._rs_cleanup = function(remoteStorage) {
    remoteStorage.stopSync();
  };

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/indexeddb.js **/
(function(global) {

  /**
   * Class: RemoteStorage.IndexedDB
   *
   *
   * IndexedDB Interface
   * -------------------
   *
   * This file exposes a get/put/delete interface, accessing data in an indexedDB.
   *
   * There are multiple parts to this interface:
   *
   *   The RemoteStorage integration:
   *     - RemoteStorage.IndexedDB._rs_supported() determines if indexedDB support
   *       is available. If it isn't, RemoteStorage won't initialize the feature.
   *     - RemoteStorage.IndexedDB._rs_init() initializes the feature. It returns
   *       a promise that is fulfilled as soon as the database has been opened and
   *       migrated.
   *
   *   The storage interface (RemoteStorage.IndexedDB object):
   *     - Usually this is accessible via "remoteStorage.local"
   *     - #get() takes a path and returns a promise.
   *     - #put() takes a path, body and contentType and also returns a promise.
   *       In addition it also takes a 'incoming' flag, which indicates that the
   *       change is not fresh, but synchronized from remote.
   *     - #delete() takes a path and also returns a promise. It also supports
   *       the 'incoming' flag described for #put().
   *     - #on('change', ...) events, being fired whenever something changes in
   *       the storage. Change events roughly follow the StorageEvent pattern.
   *       They have "oldValue" and "newValue" properties, which can be used to
   *       distinguish create/update/delete operations and analyze changes in
   *       change handlers. In addition they carry a "origin" property, which
   *       is either "window" or "remote". "remote" events are fired whenever the
   *       "incoming" flag is passed to #put() or #delete(). This is usually done
   *       by RemoteStorage.Sync.
   *
   *   The revision interface (also on RemoteStorage.IndexedDB object):
   *     - #setRevision(path, revision) sets the current revision for the given
   *       path. Revisions are only generated by the remotestorage server, so
   *       this is usually done from RemoteStorage.Sync once a pending change
   *       has been pushed out.
   *     - #setRevisions(revisions) takes path/revision pairs in the form:
   *       [[path1, rev1], [path2, rev2], ...] and updates all revisions in a
   *       single transaction.
   *     - #getRevision(path) returns the currently stored revision for the given
   *       path.
   *
   *   The changes interface (also on RemoteStorage.IndexedDB object):
   *     - Used to record local changes between sync cycles.
   *     - Changes are stored in a separate ObjectStore called "changes".
   *     - #_recordChange() records a change and is called by #put() and #delete(),
   *       given the "incoming" flag evaluates to false. It is private and should
   *       never be used from the outside.
   *     - #changesBelow() takes a path and returns a promise that will be fulfilled
   *       with an Array of changes that are pending for the given path or below.
   *       This is usually done in a sync cycle to push out pending changes.
   *     - #clearChange removes the change for a given path. This is usually done
   *       RemoteStorage.Sync once a change has successfully been pushed out.
   *     - #setConflict sets conflict attributes on a change. It also fires the
   *       "conflict" event.
   *     - #on('conflict', ...) event. Conflict events usually have the following
   *       attributes: path, localAction and remoteAction. Both actions are either
   *       "PUT" or "DELETE". They also bring a "resolve" method, which can be
   *       called with either of the strings "remote" and "local" to mark the
   *       conflict as resolved. The actual resolution will usually take place in
   *       the next sync cycle.
   */

  var RS = RemoteStorage;

  var DEFAULT_DB_NAME = 'remotestorage';
  var DEFAULT_DB;

  function keepDirNode(node) {
    return Object.keys(node.body).length > 0 ||
      Object.keys(node.cached).length > 0;
  }

  function removeFromParent(nodes, path, key) {
    var parts = path.match(/^(.*\/)([^\/]+\/?)$/);
    if(parts) {
      var dirname = parts[1], basename = parts[2];
      nodes.get(dirname).onsuccess = function(evt) {
        var node = evt.target.result;
        if(!node) {//attempt to remove something from a non-existing directory
          return;
        }
        delete node[key][basename];
        if(keepDirNode(node)) {
          nodes.put(node);
        } else {
          nodes.delete(node.path).onsuccess = function() {
            if(dirname != '/') {
              removeFromParent(nodes, dirname, key);
            }
          };
        }
      };
    }
  }

  function makeNode(path) {
    var node = { path: path };
    if(path[path.length - 1] == '/') {
      node.body = {};
      node.cached = {};
      node.contentType = 'application/json';
    }
    return node;
  }

  function addToParent(nodes, path, key, revision) {
    var parts = path.match(/^(.*\/)([^\/]+\/?)$/);
    if(parts) {
      var dirname = parts[1], basename = parts[2];
      nodes.get(dirname).onsuccess = function(evt) {
        var node = evt.target.result || makeNode(dirname);
        node[key][basename] = revision || true;
        nodes.put(node).onsuccess = function() {
          if(dirname != '/') {
            addToParent(nodes, dirname, key, true);
          }
        };
      };
    }
  }

  RS.IndexedDB = function(database) {
    this.db = database || DEFAULT_DB;
    if(! this.db) {
      if(RemoteStorage.LocalStorage) {
        RemoteStorage.log("Failed to open indexedDB, falling back to localStorage");
        return new RemoteStorage.LocalStorage();
      } else {
        throw "Failed to open indexedDB and localStorage fallback not available!";
      }
    }
    RS.eventHandling(this, 'change', 'conflict');
  };
  RS.IndexedDB.prototype = {

    get: function(path) {
      var promise = promising();
      var transaction = this.db.transaction(['nodes'], 'readonly');
      var nodes = transaction.objectStore('nodes');
      var nodeReq = nodes.get(path);
      var node;
      nodeReq.onsuccess = function() {
        node = nodeReq.result;
      };
      transaction.oncomplete = function() {
        if(node) {
          promise.fulfill(200, node.body, node.contentType, node.revision);
        } else {
          promise.fulfill(404);
        }
      };
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    put: function(path, body, contentType, incoming, revision) {
      var promise = promising();
      if(path[path.length - 1] == '/') { throw "Bad: don't PUT folders"; }
      var transaction = this.db.transaction(['nodes'], 'readwrite');
      var nodes = transaction.objectStore('nodes');
      var oldNode;
      var done;
      nodes.get(path).onsuccess = function(evt) {
        try {
          oldNode = evt.target.result;
          var node = {
            path: path, contentType: contentType, body: body
          };
          nodes.put(node).onsuccess = function() {
            try {
              addToParent(nodes, path, 'body', revision);
            } catch(e) {
              if(typeof(done) === 'undefined') {
                done = true;
                promise.reject(e);
              }
            };
          };
        } catch(e) {
          if(typeof(done) === 'undefined') {
            done = true;
            promise.reject(e);
          }
        };
      };
      transaction.oncomplete = function() {
        this._emit('change', {
          path: path,
          origin: incoming ? 'remote' : 'window',
          oldValue: oldNode ? oldNode.body : undefined,
          newValue: body
        });
        if(! incoming) {
          this._recordChange(path, { action: 'PUT', revision: oldNode ? oldNode.revision : undefined });
        }
        if(typeof(done) === 'undefined') {
          done = true;
          promise.fulfill(200);
        }
      }.bind(this);
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    delete: function(path, incoming) {
      var promise = promising();
      if(path[path.length - 1] == '/') { throw "Bad: don't DELETE folders"; }
      var transaction = this.db.transaction(['nodes'], 'readwrite');
      var nodes = transaction.objectStore('nodes');
      var oldNode;
      nodes.get(path).onsuccess = function(evt) {
        oldNode = evt.target.result;
        nodes.delete(path).onsuccess = function() {
          removeFromParent(nodes, path, 'body', incoming);
        };
      }
      transaction.oncomplete = function() {
        if(oldNode) {
          this._emit('change', {
            path: path,
            origin: incoming ? 'remote' : 'window',
            oldValue: oldNode.body,
            newValue: undefined
          });
        }
        if(! incoming) {
          this._recordChange(path, { action: 'DELETE', revision: oldNode ? oldNode.revision : undefined });
        }
        promise.fulfill(200);
      }.bind(this);
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    setRevision: function(path, revision) {
      return this.setRevisions([[path, revision]]);
    },

    setRevisions: function(revs) {
      var promise = promising();
      var transaction = this.db.transaction(['nodes'], 'readwrite');
      revs.forEach(function(rev) {
        var nodes = transaction.objectStore('nodes');
        nodes.get(rev[0]).onsuccess = function(event) {
          var node = event.target.result || makeNode(rev[0]);
          node.revision = rev[1];
          nodes.put(node).onsuccess = function() {
            addToParent(nodes, rev[0], 'cached', rev[1]);
          };
        };
      });
      transaction.oncomplete = function() {
        promise.fulfill();
      };
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    getRevision: function(path) {
      var promise = promising();
      var transaction = this.db.transaction(['nodes'], 'readonly');
      var rev;
      transaction.objectStore('nodes').
        get(path).onsuccess = function(evt) {
          if(evt.target.result) {
            rev = evt.target.result.revision;
          }
        };
      transaction.oncomplete = function() {
        promise.fulfill(rev);
      };
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    getCached: function(path) {
      if(path[path.length - 1] != '/') {
        return this.get(path);
      }
      var promise = promising();
      var transaction = this.db.transaction(['nodes'], 'readonly');
      var nodes = transaction.objectStore('nodes');
      nodes.get(path).onsuccess = function(evt) {
        var node = evt.target.result || {};
        promise.fulfill(200, node.cached, node.contentType, node.revision);
      };
      return promise;
    },

    reset: function(callback) {
      var dbName = this.db.name;
      this.db.close();
      var self = this;
      RS.IndexedDB.clean(this.db.name, function() {
        RS.IndexedDB.open(dbName, function(other) {
          // hacky!
          self.db = other.db;
          callback(self);
        });
      });
    },

    fireInitial: function() {
      var transaction = this.db.transaction(['nodes'], 'readonly');
      var cursorReq = transaction.objectStore('nodes').openCursor();
      cursorReq.onsuccess = function(evt) {
        var cursor = evt.target.result;
        if(cursor) {
          var path = cursor.key;
          if(path.substr(-1) != '/') {
            this._emit('change', {
              path: path,
              origin: 'remote',
              oldValue: undefined,
              newValue: cursor.value.body
            });
          }
          cursor.continue();
        }
      }.bind(this);
    },

    _recordChange: function(path, attributes) {
      var promise = promising();
      var transaction = this.db.transaction(['changes'], 'readwrite');
      var changes = transaction.objectStore('changes');
      var change;
      changes.get(path).onsuccess = function(evt) {
        change = evt.target.result || {};
        change.path = path;
        for(var key in attributes) {
          change[key] = attributes[key];
        }
        changes.put(change);
      };
      transaction.oncomplete = promise.fulfill;
      transaction.onerror = transaction.onabort = promise.reject;
      return promise;
    },

    clearChange: function(path) {
      var promise = promising();
      var transaction = this.db.transaction(['changes'], 'readwrite');
      var changes = transaction.objectStore('changes');
      changes.delete(path);
      transaction.oncomplete = function() {
        promise.fulfill();
      }
      return promise;
    },

    changesBelow: function(path) {
      var promise = promising();
      var transaction = this.db.transaction(['changes'], 'readonly');
      var cursorReq = transaction.objectStore('changes').
        openCursor(IDBKeyRange.lowerBound(path));
      var pl = path.length;
      var changes = [];
      cursorReq.onsuccess = function() {
        var cursor = cursorReq.result;
        if(cursor) {
          if(cursor.key.substr(0, pl) == path) {
            changes.push(cursor.value);
            cursor.continue();
          }
        }
      };
      transaction.oncomplete = function() {
        promise.fulfill(changes);
      };
      return promise;
    },

    setConflict: function(path, attributes) {
      var event = { path: path };
      for(var key in attributes) {
        event[key] = attributes[key];
      }
      this._recordChange(path, { conflict: attributes }).
        then(function() {
          // fire conflict once conflict has been recorded.
          if(this._handlers.conflict.length > 0) {
            this._emit('conflict', event);
          } else {
            setTimeout(function() { event.resolve('remote'); }, 0);
          }
        }.bind(this));
      event.resolve = function(resolution) {
        if(resolution == 'remote' || resolution == 'local') {
          attributes.resolution = resolution;
          this._recordChange(path, { conflict: attributes });
        } else {
          throw "Invalid resolution: " + resolution;
        }
      }.bind(this);
    },

    closeDB: function() {
      this.db.close();
    }

  };

  var DB_VERSION = 2;
  RS.IndexedDB.open = function(name, callback) {
    var timer = setTimeout(function() {
      callback("timeout trying to open db");
    }, 3500);

    var dbOpen = indexedDB.open(name, DB_VERSION);
    dbOpen.onerror = function() {
      console.error('opening db failed', dbOpen);
      alert('remoteStorage not supported (private browsing mode?)');
      clearTimeout(timer);
      callback(dbOpen.error);
    };
    dbOpen.onupgradeneeded = function(event) {
      RemoteStorage.log("[IndexedDB] Upgrade: from ", event.oldVersion, " to ", event.newVersion);
      var db = dbOpen.result;
      if(event.oldVersion != 1) {
        RemoteStorage.log("[IndexedDB] Creating object store: nodes");
        db.createObjectStore('nodes', { keyPath: 'path' });
      }
      RemoteStorage.log("[IndexedDB] Creating object store: changes");
      db.createObjectStore('changes', { keyPath: 'path' });
    }
    dbOpen.onsuccess = function() {
      clearTimeout(timer);
      callback(null, dbOpen.result);
    };
  };

  RS.IndexedDB.clean = function(databaseName, callback) {
    var req = indexedDB.deleteDatabase(databaseName);
    req.onsuccess = function() {
      RemoteStorage.log('done removing db');
      callback();
    };
    req.onerror = req.onabort = function(evt) {
      console.error('failed to remove database "' + databaseName + '"', evt);
    };
  };

  RS.IndexedDB._rs_init = function(remoteStorage) {
    var promise = promising();
    RS.IndexedDB.open(DEFAULT_DB_NAME, function(err, db) {
      if(err) {
        if(err.name == 'InvalidStateError') {
          // firefox throws this when trying to open an indexedDB in private browsing mode
          var err = new Error("IndexedDB couldn't be opened.");
          // instead of a stack trace, display some explaination:
          err.stack = "If you are using Firefox, please disable\nprivate browsing mode.\n\nOtherwise please report your problem\nusing the link below";
          remoteStorage._emit('error', err);
        } else {
        }
      } else {
        DEFAULT_DB = db;
        db.onerror = function() { remoteStorage._emit('error', err); };
        promise.fulfill();
      }
    });
    return promise;
  };

  RS.IndexedDB._rs_supported = function() {
    return 'indexedDB' in global;
  }

  RS.IndexedDB._rs_cleanup = function(remoteStorage) {
    if(remoteStorage.local) {
      remoteStorage.local.closeDB();
    }
    var promise = promising();
    RS.IndexedDB.clean(DEFAULT_DB_NAME, function() {
      promise.fulfill();
    });
    return promise;
  }

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/localstorage.js **/
(function(global) {

  var NODES_PREFIX = "remotestorage:cache:nodes:";
  var CHANGES_PREFIX = "remotestorage:cache:changes:";

  RemoteStorage.LocalStorage = function() {
    RemoteStorage.eventHandling(this, 'change', 'conflict');
  };

  function makeNode(path) {
    var node = { path: path };
    if(path[path.length - 1] == '/') {
      node.body = {};
      node.cached = {};
      node.contentType = 'application/json';
    }
    return node;
  }
  
  
  function b64ToUint6 (nChr) {
    return nChr > 64 && nChr < 91 ?
      nChr - 65
      : nChr > 96 && nChr < 123 ?
      nChr - 71
      : nChr > 47 && nChr < 58 ?
      nChr + 4
      : nChr === 43 ?
      62
      : nChr === 47 ?
      63
      :
      0;
  }
  function base64DecToArr (sBase64, nBlocksSize) {
    var
    sB64Enc = sBase64.replace(/[^A-Za-z0-9\+\/]/g, ""), nInLen = sB64Enc.length,
    nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2, taBytes = new Uint8Array(nOutLen);
    
    for (var nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
      nMod4 = nInIdx & 3;
      nUint24 |= b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 18 - 6 * nMod4;
      if (nMod4 === 3 || nInLen - nInIdx === 1) {
        for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
          taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
        }
        nUint24 = 0;
        
      }
    }
    return taBytes;
  }
  //helper to decide if node body is binary or not
  function isBinary(node){
    return node.match(/charset=binary/);
  }

  RemoteStorage.LocalStorage.prototype = {
    toBase64: function(data){
      var arr = new Uint8Array(data);
      var str = ''
      for(var i = 0; i < arr.length; i++) {
        //atob(btoa(String.fromCharCode(arr[0]))).charCodeAt(0)
        str+=String.fromCharCode(arr[i]);
      }
      return btoa(str);
      
    },
    toArrayBuffer: base64DecToArr,
    get: function(path) {
      var node = this._get(path);
      if(node) {
        if(isBinary(node.contentType)){
          node.body = this.toArrayBuffer(node.body);
        }
        return promising().fulfill(200, node.body, node.contentType, node.revision);
      } else {
        return promising().fulfill(404);
      }
    },

    put: function(path, body, contentType, incoming, revision) {
      var oldNode = this._get(path);
      if(isBinary(contentType)){
        body = this.toBase64(body);
      }
      var node = {
        path: path, contentType: contentType, body: body
      };
      localStorage[NODES_PREFIX + path] = JSON.stringify(node);
      this._addToParent(path, revision);
      this._emit('change', {
        path: path,
        origin: incoming ? 'remote' : 'window',
        oldValue: oldNode ? oldNode.body : undefined,
        newValue: body
      });
      if(! incoming) {
        this._recordChange(path, { action: 'PUT' });
      }
      return promising().fulfill(200);
    },
   get: function(path) {
      var node = this._get(path);
      if(node) {
        if(isBinary(node.contentType)){
          node.body = this.toArrayBuffer(node.body);
        }
        return promising().fulfill(200, node.body, node.contentType, node.revision);
      } else {
        return promising().fulfill(404);
      }
    },

    put: function(path, body, contentType, incoming) {
      var oldNode = this._get(path);
      if(isBinary(contentType)){
        body = this.toBase64(body);
      }
      var node = {
        path: path, contentType: contentType, body: body
      };
      localStorage[NODES_PREFIX + path] = JSON.stringify(node);
      this._addToParent(path);
      this._emit('change', {
        path: path,
        origin: incoming ? 'remote' : 'window',
        oldValue: oldNode ? oldNode.body : undefined,
        newValue: body
      });
      if(! incoming) {
        this._recordChange(path, { action: 'PUT' });
      }
      return promising().fulfill(200);
    },
    'delete': function(path, incoming) {
      var oldNode = this._get(path);
      delete localStorage[NODES_PREFIX + path];
      this._removeFromParent(path);
      if(oldNode) {
        this._emit('change', {
          path: path,
          origin: incoming ? 'remote' : 'window',
          oldValue: oldNode.body,
          newValue: undefined
        });
      }
      if(! incoming) {
        this._recordChange(path, { action: 'DELETE' });
      }
      return promising().fulfill(200);
    },

    setRevision: function(path, revision) {
      var node = this._get(path) || makeNode(path);
      node.revision = revision;
      localStorage[NODES_PREFIX + path] = JSON.stringify(node);
      return promising().fulfill();
    },

    getRevision: function(path) {
      var node = this._get(path);
      return promising.fulfill(node ? node.revision : undefined);
    },

    _get: function(path) {
      var node;
      try {
        node = JSON.parse(localStorage[NODES_PREFIX + path]);
      } catch(e) { /* ignored */ }
      return node;
    },

    _recordChange: function(path, attributes) {
      var change;
      try {
        change = JSON.parse(localStorage[CHANGES_PREFIX + path]);
      } catch(e) {
        change = {};
      }
      for(var key in attributes) {
        change[key] = attributes[key];
      }
      change.path = path;
      localStorage[CHANGES_PREFIX + path] = JSON.stringify(change);
    },

    clearChange: function(path) {
      delete localStorage[CHANGES_PREFIX + path];
      return promising().fulfill();
    },

    changesBelow: function(path) {
      var changes = [];
      var kl = localStorage.length;
      var prefix = CHANGES_PREFIX + path, pl = prefix.length;
      for(var i=0;i<kl;i++) {
        var key = localStorage.key(i);
        if(key.substr(0, pl) == prefix) {
          changes.push(JSON.parse(localStorage[key]));
        }
      }
      return promising().fulfill(changes);
    },

    setConflict: function(path, attributes) {
      var event = { path: path };
      for(var key in attributes) {
        event[key] = attributes[key];
      }
      this._recordChange(path, { conflict: attributes });
      event.resolve = function(resolution) {
        if(resolution == 'remote' || resolution == 'local') {
          attributes.resolution = resolution;
          this._recordChange(path, { conflict: attributes });
        } else {
          throw "Invalid resolution: " + resolution;
        }
      }.bind(this);
      this._emit('conflict', event);
    },

    _addToParent: function(path, revision) {
      var parts = path.match(/^(.*\/)([^\/]+\/?)$/);
      if(parts) {
        var dirname = parts[1], basename = parts[2];
        var node = this._get(dirname) || makeNode(dirname);
        node.body[basename] = revision || true;
        localStorage[NODES_PREFIX + dirname] = JSON.stringify(node);
        if(dirname != '/') {
          this._addToParent(dirname, true);
        }
      }
    },

    _removeFromParent: function(path) {
      var parts = path.match(/^(.*\/)([^\/]+\/?)$/);
      if(parts) {
        var dirname = parts[1], basename = parts[2];
        var node = this._get(dirname);
        if(node) {
          delete node.body[basename];
          if(Object.keys(node.body).length > 0) {
            localStorage[NODES_PREFIX + dirname] = JSON.stringify(node);
          } else {
            delete localStorage[NODES_PREFIX + dirname];
            if(dirname != '/') {
              this._removeFromParent(dirname);
            }
          }
        }
      }
    },

    fireInitial: function() {
      var l = localStorage.length, npl = NODES_PREFIX.length;
      for(var i=0;i<l;i++) {
        var key = localStorage.key(i);
        if(key.substr(0, npl) == NODES_PREFIX) {
          var path = key.substr(npl);
          var node = this._get(path);
          this._emit('change', {
            path: path,
            origin: 'remote',
            oldValue: undefined,
            newValue: node.body
          });
        }
      }
    }

  };

  RemoteStorage.LocalStorage._rs_init = function() {};

  RemoteStorage.LocalStorage._rs_supported = function() {
    return 'localStorage' in global;
  };

  RemoteStorage.LocalStorage._rs_cleanup = function() {
    var l = localStorage.length;
    var npl = NODES_PREFIX.length, cpl = CHANGES_PREFIX.length;
    var remove = [];
    for(var i=0;i<l;i++) {
      var key = localStorage.key(i);
      if(key.substr(0, npl) == NODES_PREFIX ||
         key.substr(0, cpl) == CHANGES_PREFIX) {
        remove.push(key);
      }
    }
    remove.forEach(function(key) {
      console.log('removing', key);
      delete localStorage[key];
    });
  };

})(typeof(window) !== 'undefined' ? window : global);


/** FILE: src/modules.js **/
(function() {

  RemoteStorage.MODULES = {};

  RemoteStorage.defineModule = function(moduleName, builder) {
    RemoteStorage.MODULES[moduleName] = builder;

    Object.defineProperty(RemoteStorage.prototype, moduleName, {
      configurable: true,
      get: function() {
        var instance = this._loadModule(moduleName);
        Object.defineProperty(this, moduleName, {
          value: instance
        });
        return instance;
      }
    });

    if(moduleName.indexOf('-') != -1) {
      var camelizedName = moduleName.replace(/\-[a-z]/g, function(s) {
        return s[1].toUpperCase();
      });
      Object.defineProperty(RemoteStorage.prototype, camelizedName, {
        get: function() {
          return this[moduleName];
        }
      });
    }
  };

  RemoteStorage.prototype._loadModule = function(moduleName) {
    var builder = RemoteStorage.MODULES[moduleName];
    if(builder) {
      var module = builder(new RemoteStorage.BaseClient(this, '/' + moduleName + '/'),
                           new RemoteStorage.BaseClient(this, '/public/' + moduleName + '/'));
      return module.exports;
    } else {
      throw "Unknown module: " + moduleName;
    }
  };

  RemoteStorage.prototype.defineModule = function(moduleName) {
    console.log("remoteStorage.defineModule is deprecated, use RemoteStorage.defineModule instead!");
    RemoteStorage.defineModule.apply(RemoteStorage, arguments);
  };

})();


/** FILE: src/debug/inspect.js **/
(function() {
  function loadTable(table, storage, paths) {
    table.setAttribute('border', '1');
    table.style.margin = '8px';
    table.innerHTML = '';
    var thead = document.createElement('thead');
    table.appendChild(thead);
    var titleRow = document.createElement('tr');
    thead.appendChild(titleRow);
    ['Path', 'Content-Type', 'Revision'].forEach(function(label) {
      var th = document.createElement('th');
      th.textContent = label;
      thead.appendChild(th);
    });

    var tbody = document.createElement('tbody');
    table.appendChild(tbody);

    function renderRow(tr, path, contentType, revision) {
      [path, contentType, revision].forEach(function(value) {
        var td = document.createElement('td');
        td.textContent = value || '';
        tr.appendChild(td);
      });      
    }

    function loadRow(path) {
      if(storage.connected === false) return;
      function processRow(status, body, contentType, revision) {
        if(status == 200) {
          var tr = document.createElement('tr');
          tbody.appendChild(tr);
          renderRow(tr, path, contentType, revision);
          if(path[path.length - 1] == '/') {
            for(var key in body) {
              loadRow(path + key);
            }
          }
        }
      }
      storage.get(path).then(processRow);
    }

    paths.forEach(loadRow);
  }


  function renderWrapper(title, table, storage, paths) {
    var wrapper = document.createElement('div');
    //wrapper.style.display = 'inline-block';
    var heading = document.createElement('h2');
    heading.textContent = title;
    wrapper.appendChild(heading);
    var updateButton = document.createElement('button');
    updateButton.textContent = "Refresh";
    updateButton.onclick = function() { loadTable(table, storage, paths); };
    wrapper.appendChild(updateButton);
    if(storage.reset) {
      var resetButton = document.createElement('button');
      resetButton.textContent = "Reset";
      resetButton.onclick = function() {
        storage.reset(function(newStorage) {
          storage = newStorage;
          loadTable(table, storage, paths);
        });
      };
      wrapper.appendChild(resetButton);
    }
    wrapper.appendChild(table);
    loadTable(table, storage, paths);
    return wrapper;
  }

  function renderLocalChanges(local) {
    var wrapper = document.createElement('div');
    //wrapper.style.display = 'inline-block';
    var heading = document.createElement('h2');
    heading.textContent = "Outgoing changes";
    wrapper.appendChild(heading);
    var updateButton = document.createElement('button');
    updateButton.textContent = "Refresh";
    wrapper.appendChild(updateButton);
    var list = document.createElement('ul');
    list.style.fontFamily = 'courier';
    wrapper.appendChild(list);

    function updateList() {
      local.changesBelow('/').then(function(changes) {
        list.innerHTML = '';
        changes.forEach(function(change) {
          var el = document.createElement('li');
          el.textContent = JSON.stringify(change);
          list.appendChild(el);
        });
      });
    }

    updateButton.onclick = updateList;
    updateList();
    return wrapper;
  }

  RemoteStorage.prototype.inspect = function() {

    var widget = document.createElement('div');
    widget.id = 'remotestorage-inspect';
    widget.style.position = 'absolute';
    widget.style.top = 0;
    widget.style.left = 0;
    widget.style.background = 'black';
    widget.style.color = 'white';
    widget.style.border = 'groove 5px #ccc';

    var controls = document.createElement('div');
    controls.style.position = 'absolute';
    controls.style.top = 0;
    controls.style.left = 0;

    var heading = document.createElement('strong');
    heading.textContent = " remotestorage.js inspector ";

    controls.appendChild(heading);

    if(this.local) {
      var syncButton = document.createElement('button');
      syncButton.textContent = "Synchronize";
      controls.appendChild(syncButton);
    }

    var closeButton = document.createElement('button');
    closeButton.textContent = "Close";
    closeButton.onclick = function() {
      document.body.removeChild(widget);
    }
    controls.appendChild(closeButton);

    widget.appendChild(controls);

    var remoteTable = document.createElement('table');
    var localTable = document.createElement('table');
    widget.appendChild(renderWrapper("Remote", remoteTable, this.remote, this.caching.rootPaths));
    if(this.local) {
      widget.appendChild(renderWrapper("Local", localTable, this.local, ['/']));
      widget.appendChild(renderLocalChanges(this.local));

      syncButton.onclick = function() {
        this.log('sync clicked');
        this.sync().then(function() {
          this.log('SYNC FINISHED');
          loadTable(localTable, this.local, ['/'])
        }.bind(this), function(err) {
          console.error("SYNC FAILED", err, err.stack);
        });
      }.bind(this);
    }

    document.body.appendChild(widget);
  };

})();


/** FILE: src/legacy.js **/

(function() {
  var util = {
    getEventEmitter: function() {
      var object = {};
      var args = Array.prototype.slice.call(arguments);
      args.unshift(object);
      RemoteStorage.eventHandling.apply(RemoteStorage, args);
      object.emit = object._emit;
      return object;
    },

    extend: function(target) {
      var sources = Array.prototype.slice.call(arguments, 1);
      sources.forEach(function(source) {
        for(var key in source) {
          target[key] = source[key];
        }
      });
      return target;
    },

    asyncEach: function(array, callback) {
      return this.asyncMap(array, callback).
        then(function() { return array; });
    },

    asyncMap: function(array, callback) {
      var promise = promising();
      var n = array.length, i = 0;
      var results = [], errors = [];
      function oneDone() {
        i++;
        if(i == n) {
          promise.fulfill(results, errors);
        }
      }
      array.forEach(function(item, index) {
        try {
          var result = callback(item);
        } catch(exc) {
          oneDone();
          errors[index] = exc;
        }
        if(typeof(result) == 'object' && typeof(result.then) == 'function') {
          result.then(function(res) { results[index] = res; oneDone(); },
                      function(error) { errors[index] = res; oneDone(); });
        } else {
          oneDone();
          results[index] = result;
        }
      });
      return promise;
    },

    containingDir: function(path) {
      var dir = path.replace(/[^\/]+\/?$/, '');
      return dir == path ? null : dir;
    },

    isDir: function(path) {
      return path.substr(-1) == '/';
    },

    baseName: function(path) {
      var parts = path.split('/');
      if(util.isDir(path)) {
        return parts[parts.length-2]+'/';
      } else {
        return parts[parts.length-1];
      }
    },

    bindAll: function(object) {
      for(var key in this) {
        if(typeof(object[key]) == 'function') {
          object[key] = object[key].bind(object);
        }
      }
    }
  };

  Object.defineProperty(RemoteStorage.prototype, 'util', {
    get: function() {
      console.log("DEPRECATION WARNING: remoteStorage.util is deprecated and will be removed with the next major release.");
      return util;
    }
  });

})();


/** FILE: src/googledrive.js **/
(function(global) {

  var RS = RemoteStorage;

  var BASE_URL = 'https://www.googleapis.com';
  var AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
  var AUTH_SCOPE = 'https://www.googleapis.com/auth/drive';

  var GD_DIR_MIME_TYPE = 'application/vnd.google-apps.folder';
  var RS_DIR_MIME_TYPE = 'application/json; charset=UTF-8';

  function buildQueryString(params) {
    return Object.keys(params).map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
  }

  function fileNameFromMeta(meta) {
    return encodeURIComponent(meta.title) + (meta.mimeType == GD_DIR_MIME_TYPE ? '/' : '');
  }

  function metaTitleFromFileName(filename) {
    if(filename.substr(-1) == '/') {
      filename = filename.substr(0, filename.length - 1);
    }
    return decodeURIComponent(filename);
  }

  function parentPath(path) {
    return path.replace(/[^\/]+\/?$/, '');
  }

  function baseName(path) {
    var parts = path.split('/');
    if(path.substr(-1) == '/') {
      return parts[parts.length-2]+'/';
    } else {
      return parts[parts.length-1];
    }
  }

  var Cache = function(maxAge) {
    this.maxAge = maxAge;
    this._items = {};
  };

  Cache.prototype = {
    get: function(key) {
      var item = this._items[key];
      var now = new Date().getTime();
      return (item && item.t >= (now - this.maxAge)) ? item.v : undefined;
    },

    set: function(key, value) {
      this._items[key] = {
        v: value,
        t: new Date().getTime()
      };
    }
  };

  RS.GoogleDrive = function(remoteStorage, clientId) {

    RS.eventHandling(this, 'connected');

    this.rs = remoteStorage;
    this.clientId = clientId;

    this._fileIdCache = new Cache(60 * 5); // ids expire after 5 minutes (is this a good idea?)

    setTimeout(function() {
      this.configure(undefined, undefined, undefined, localStorage['remotestorage:googledrive:token']);
    }.bind(this), 0);
  };

  RS.GoogleDrive.prototype = {

    configure: function(_x, _y, _z, token) { // parameter list compatible with WireClient
      if(token) {
        localStorage['remotestorage:googledrive:token'] = token;
        this.token = token;
        this.connected = true;
        this._emit('connected');
      } else {
        this.connected = false;
        delete this.token;
        // not reseting backend whenever googledrive gets initialized without an token 
//       this.rs.setBackend(undefined);
        delete localStorage['remotestorage:googledrive:token'];
      }
    },

    connect: function() {
      this.rs.setBackend('googledrive');
      RS.Authorize(AUTH_URL, AUTH_SCOPE, String(document.location), this.clientId);
    },

    get: function(path, options) {
      if(path.substr(-1) == '/') {
        return this._getDir(path, options);
      } else {
        return this._getFile(path, options);
      }
    },

    put: function(path, body, contentType, options) {
      var promise = promising();
      function putDone(error, response) {
        if(error) {
          promise.reject(error);
        } else if(response.status >= 200 && response.status < 300) {
          var meta = JSON.parse(response.responseText);
          promise.fulfill(200, undefined, meta.mimeType, meta.etag);
        } else {
          promise.reject("PUT failed with status " + response.status + " (" + response.responseText + ")");
        }
      }
      this._getFileId(path, function(idError, id) {
        if(idError) {
          promise.reject(idError);
          return;
        } else if(id) {
          this._updateFile(id, path, body, contentType, options, putDone);
        } else {
          this._createFile(path, body, contentType, options, putDone);
        }
      });
      return promise;
    },

    'delete': function(path, options) {
      var promise = promising();
      this._getFileId(path, function(idError, id) {
        if(idError) {
          promise.reject(idError);
        } else if(id) {
          this._request('DELETE', BASE_URL + '/drive/v2/files/' + id, {}, function(deleteError, response) {
            if(deleteError) {
              promise.reject(deleteError);
            } else if(response.status == 200 || response.status == 204) {
              promise.fulfill(200);
            } else {
              promise.reject("Delete failed: " + response.status + " (" + response.responseText + ")");
            }
          });
        } else {
          // file doesn't exist. ignore.
          promise.fulfill(200);
        }
      });
      return promise;
    },

    _updateFile: function(id, path, body, contentType, options, callback) {
      callback = callback.bind(this);
      var metadata = {
        mimeType: contentType
      };
      this._request('PUT', BASE_URL + '/upload/drive/v2/files/' + id + '?uploadType=resumable', {
        body: JSON.stringify(metadata),
        headers: {
          'Content-Type': 'application/json; charset=UTF-8'
        }
      }, function(metadataError, response) {
        if(metadataError) {
          callback(metadataError);
        } else {
          this._request('PUT', response.getResponseHeader('Location'), {
            body: contentType.match(/^application\/json/) ? JSON.stringify(body) : body
          }, callback);
        }
      });
    },

    _createFile: function(path, body, contentType, options, callback) {
      callback = callback.bind(this);
      this._getParentId(path, function(parentIdError, parentId) {
        if(parentIdError) {
          callback(parentIdError);
          return;
        }
        var fileName = baseName(path);
        var metadata = {
          title: metaTitleFromFileName(fileName),
          mimeType: contentType,
          parents: [{
            kind: "drive#fileLink",
            id: parentId
          }]
        };
        this._request('POST', BASE_URL + '/upload/drive/v2/files?uploadType=resumable', {
          body: JSON.stringify(metadata),
          headers: {
            'Content-Type': 'application/json; charset=UTF-8'
          }
        }, function(metadataError, response) {
          if(metadataError) {
            callback(metadataError);
          } else {
            this._request('POST', response.getResponseHeader('Location'), {
              body: contentType.match(/^application\/json/) ? JSON.stringify(body) : body
            }, callback);
          }
        });
      });
    },

    _getFile: function(path, options) {
      var promise = promising();
      this._getFileId(path, function(idError, id) {
        if(idError) {
          promise.reject(idError);
        } else {
          this._getMeta(id, function(metaError, meta) {
            if(metaError) {
              promise.reject(metaError);
            } else if(meta.downloadUrl) {
              var options = {};
              if(meta.mimeType.match(/charset=binary/)) {
                options.responseType = 'blob';
              }
              this._request('GET', meta.downloadUrl, options, function(downloadError, response) {
                if(downloadError) {
                  promise.reject(downloadError);
                } else {
                  var body = response.response;
                  if(meta.mimeType.match(/^application\/json/)) {
                    try {
                      body = JSON.parse(body);
                    } catch(e) {}
                  }
                  promise.fulfill(200, body, meta.mimeType, meta.etag);
                }
              });
            } else {
              // empty file
              promise.fulfill(200, '', meta.mimeType, meta.etag);
            }
          });
        }
      });
      return promise;
    },

    _getDir: function(path, options) {
      var promise = promising();
      this._getFileId(path, function(idError, id) {
        if(idError) {
          promise.reject(idError);
        } else if(! id) {
          promise.fulfill(404);
        } else {
          this._request('GET', BASE_URL + '/drive/v2/files/' + id + '/children', {}, function(childrenError, response) {
            if(childrenError) {
              promise.reject(childrenError);
            } else {
              if(response.status == 200) {
                var data = JSON.parse(response.responseText);
                var n = data.items.length, i = 0;
                if(n == 0) {
                  // FIXME: add revision of directory!
                  promise.fulfill(200, {}, RS_DIR_MIME_TYPE, undefined);
                  return;
                }
                var result = {};
                var idCache = {};
                var gotMeta = function(err, meta) {
                  if(err) {
                    // FIXME: actually propagate the error.
                    console.error("getting meta stuff failed: ", err);
                  } else {
                    var fileName = fileNameFromMeta(meta);
                    // NOTE: the ETags are double quoted. This is not a bug, but just the
                    // way etags from google drive look like.
                    // Example listing:
                    //  {
                    //    "CMakeCache.txt": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA1OTk5NjE1NA\"",
                    //    "CMakeFiles": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA1OTk5NjUxNQ\"",
                    //    "Makefile": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA2MDIwNDA0OQ\"",
                    //    "bgrive": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA1OTkzODE4Nw\"",
                    //    "cmake_install.cmake": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA1OTkzNzU2NA\"",
                    //    "grive": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA1OTk2Njg2Ng\"",
                    //    "libgrive": "\"HK9znrxLd1pIgz63yXyznaLN5rM/MTM3NzA2MDAxNDk1NQ\""
                    //  }
                    result[fileName] = meta.etag;

                    // propagate id cache
                    this._fileIdCache.set(path + fileName, meta.id);
                  }
                  i++;
                  if(i == n) {
                    promise.fulfill(200, result, RS_DIR_MIME_TYPE, undefined);
                  }
                }.bind(this);
                data.items.forEach(function(item) {
                  this._getMeta(item.id, gotMeta);
                }.bind(this));
              } else {
                promise.reject('request failed or something: ' + response.status);
              }
            }
          });
        }
      });
      return promise;
    },


    _getParentId: function(path, callback) {
      callback = callback.bind(this);
      var dirname = parentPath(path);
      this._getFileId(dirname, function(idError, parentId) {
        if(idError) {
          callback(idError);
        } else if(parentId) {
          callback(null, parentId);
        } else {
          this._createDir(dirname, callback);
        }
      });
    },

    _createDir: function(path, callback) {
      callback = callback.bind(this);
      this._getParentId(path, function(idError, parentId) {
        if(idError) {
          callback(idError);
        } else {
          this._request('POST', BASE_URL + '/drive/v2/files', {
            body: JSON.stringify({
              title: metaTitleFromFileName(baseName(path)),
              mimeType: GD_DIR_MIME_TYPE,
              parents: [{
                id: parentId
              }]
            }),
            headers: {
              'Content-Type': 'application/json; charset=UTF-8'
            }
          }, function(createError, response) {
            if(createError) {
              callback(createError);
            } else {
              var meta = JSON.parse(response.responseText);
              callback(null, meta.id);
            }
          });
        }
      });
    },

    _getFileId: function(path, callback) {
      callback = callback.bind(this);
      var id;
      if(path == '/') {
        // "root" is a special alias for the fileId of the root directory
        callback(null, 'root');
      } else if((id = this._fileIdCache.get(path))) {
        // id is cached.
        callback(null, id);
      } else {
        // id is not cached (or file doesn't exist).
        // load parent directory listing to propagate / update id cache.
        this._getDir(parentPath(path)).then(function() {
          callback(null, this._fileIdCache.get(path));
        }.bind(this), callback);
      }
    },

    _getMeta: function(id, callback) {
      callback = callback.bind(this);
      this._request('GET', BASE_URL + '/drive/v2/files/' + id, {}, function(err, response) {
        if(err) {
          callback(err);
        } else {
          if(response.status == 200) {
            callback(null, JSON.parse(response.responseText));
          } else {
            callback("request (getting metadata for " + id + ") failed with status: " + response.status);
          }
        }
      });
    },

    _request: function(method, url, options, callback) {
      callback = callback.bind(this);
      if(! options.headers) options.headers = {};
      options.headers['Authorization'] = 'Bearer ' + this.token;
      RS.WireClient.request.call(this, method, url, options, function(err, xhr) {
        // google tokens expire from time to time...
        if(xhr.status == 401) {
          this.connect();
          return;
        }
        callback(err, xhr);
      });
    }
  };

  RS.GoogleDrive._rs_init = function(remoteStorage) {
    var config = remoteStorage.apiKeys.googledrive;
    if(config) {
      remoteStorage.googledrive = new RS.GoogleDrive(remoteStorage, config.client_id);
      if(remoteStorage.backend == 'googledrive') {
        remoteStorage._origRemote = remoteStorage.remote;
        remoteStorage.remote = remoteStorage.googledrive;
      }
    }
  };
  RS.GoogleDrive._rs_supported = function(rs){
    return true; 
  }
  RS.GoogleDrive._rs_cleanup = function(remoteStorage) {
    remoteStorage.setBackend(undefined);
    if(remoteStorage._origRemote) {
      remoteStorage.remote = remoteStorage._origRemote;
      delete remoteStorage._origRemote;
    }
  };

})(this);


/** FILE: src/dropbox.js **/
(function(global) {
  var RS = RemoteStorage;
  // next steps : 
  //  features:
  // handle fetchDelta has_more
  // handle files larger than 150MB
  // 
  //  testing:
  // add to remotestorage browser
  // add to sharedy
  // maybe write tests for remote
  //
 

  /**
   * Dropbox backend for RemoteStorage.js
   * this file exposes a get/put/delete interface which is compatible with the wireclient
   * it requires to get configured with a dropbox token similar to the wireclient.configure
   *
   * when the remotestorage.backend was set to 'dropbox' it will initialize and resets 
   * remoteStorage.remote with remoteStorage.dropbox
   * 
   * for compability with the public directory the getItemURL function of the BaseClient gets 
   * highjackt and returns the dropbox share-url
   *
   * to connect with dropbox a connect function is provided
   *
   * known issues : 
   *   files larger than 150mb are not suported for upload
   *   directories with more than 10.000 files will cause problems to list
   *   content-type is guessed by dropbox.com therefore they aren't fully supported
   *   dropbox preserves cases but not case sensitive
   *   share_urls and therfeor getItemURL is asynchronius , which means 
   *     getItemURL returns usefull values after the syncCycle
   **/
  var haveLocalStorage;
  var AUTH_URL = 'https://www.dropbox.com/1/oauth2/authorize';
  var SETTINGS_KEY = 'remotestorage:dropbox';
  var cleanPath = RS.WireClient.cleanPath
  /*************************
   * LowerCaseCache
   * this Cache will lowercase it's keys 
   * and can propagate the values to "upper directories"
   * 
   * intialized with default Value(undefined will be accepted)
   *
   * set and delete will be set to justSet and justDelete on initialization 
   *
   * get : get a value or default Value
   * set : set a value
   * justSet : just set a value and don't propagate at all
   * propagateSet : Set a value and propagate
   * delete : delete 
   * justDelete : just delete a value and don't propagate at al
   * propagateDelete : deleta a value and propagate
   * _activatePropagation : replace set and delete with their propagate versions
   *************************/
  function LowerCaseCache(defaultValue){
    this.defaultValue = defaultValue; //defaults to undefimned if initialized without arguments
    this._storage = { };
    this.set = this.justSet;
    this.delete = this.justDelete;
  }
  LowerCaseCache.prototype = {
    get : function(key) {
      key = key.toLowerCase();
      var stored = this._storage[key]
      if(typeof stored == 'undefined'){
        stored = this.defaultValue;
        this._storage[key] = stored;
      }
      return stored;
    },
    propagateSet : function(key, value) {
      key = key.toLowerCase();
      if(this._storage[key] == value) 
        return value;
      this._propagate(key, value);
      return this._storage[key] = value;
    },
    propagateDelete : function(key) {
      var key = key.toLowerCase();
      this._propagate(key, this._storage[key]);
      return delete this._storage[key];
    },
    _activatePropagation: function(){
      this.set = this.propagateSet;
      this.delete = this.propagateDelete;
      return true;
    },
    justSet : function(key, value) {
      key = key.toLowerCase();
      return this._storage[key] = value;
    },
    justDelete : function(key, value) {
      var key = key.toLowerCase();
      return delete this._storage[key];
    },
    _propagate: function(key, rev){
      var dirs = key.split('/').slice(0,-1);
      var len = dirs.length;
      var path = '';
      
      for(var i = 0; i < len; i++){
        path+=dirs[i]+'/'
        if(!rev)
          rev = this._storage[path]+1
        this._storage[path] =  rev;
      }
    }
  }
  /****************************
   * Dropbox - Backend for remtoeStorage.js
   * methods : 
   * connect
   * configure
   * get
   * put
   * delete
   * share
   * info
   * Properties :
   * connected
   * rs
   * token
   * userAddress
   *****************************/
  RS.Dropbox = function(rs) {

    this.rs = rs;
    this.connected = false;
    this.rs = rs;
    var self = this;

    RS.eventHandling(this, 'change', 'connected');
    rs.on('error', function(error){
      if(error instanceof RemoteStorage.Unauthorized) {
        self.configure(null,null,null,null)
      }
    });
    
    this.clientId = rs.apiKeys.dropbox.api_key;
    this._revCache = new LowerCaseCache('rev');
    this._itemRefs = {};
    
    if(haveLocalStorage){
      var settings;
      try {
        settings = JSON.parse(localStorage[SETTINGS_KEY]);
      } catch(e){}
      if(settings) {
        this.configure(settings.userAddress, undefined, undefined, settings.token);
      }
      try {
        this._itemRefs = JSON.parse(localStorage[ SETTINGS_KEY+':shares' ])
      } catch(e) {  }
    }
    if(this.connected) {
      setTimeout(this._emit.bind(this), 0, 'connected');
    }
  };

  RS.Dropbox.prototype = {
    /**
     * Method : connect()
     *   redirects to AUTH_URL(https://www.dropbox.com/1/oauth2/authorize)
     *   and set's backend to dropbox
     *   therefor it starts the auth flow and end's up with a token and the dropbox backend in place
     **/
    connect: function() {
      //ToDo handling when token is already present
      this.rs.setBackend('dropbox');
      if(this.token){
        hookIt(this.rs);
      } else {
        RS.Authorize(AUTH_URL, '', String(document.location), this.clientId);
      }
    },
    /**
     * Mehtod : configure(userAdress, x, x, token)
     *   accepts it's parameters according to the wireClient
     *   set's the connected flag
     **/
    configure: function(userAddress, href, storageApi, token) {
      console.log('dropbox configure',arguments);
      if(typeof token !== 'undefined') this.token = token;
      if(typeof userAddress !== 'undefined') this.userAddress = userAddress;

      if(this.token){
        this.connected = true;
        if( !this.userAddress ){
          this.info().then(function(info){
            this.userAddress = info.display_name;
            //FIXME propagate this to the view
          }.bind(this))
        }
        this._emit('connected');
      } else {
        this.connected = false;
      }
      if(haveLocalStorage){
        localStorage[SETTINGS_KEY] = JSON.stringify( { token: this.token,
                                                       userAddress: this.userAddress } );
      }
    },
    /**
     * Method : _getDir(path, options)
     **/
    _getDir: function(path, options){
      var url = 'https://api.dropbox.com/1/metadata/auto'+path;
      var promise = promising();
      var revCache = this._revCache;
      this._request('GET', url, {}, function(err, resp){
        if(err){
          promise.reject(err);
        }else{
          var status = resp.status;
          if(status==304){
            promise.fulfill(status);
            return;
          }  
          var listing, body, mime, rev;
          try{
            body = JSON.parse(resp.responseText)
          } catch(e) {
            promise.reject(e);
            return;
          }
          rev = this._revCache.get(path)
          mime = 'application/json; charset=UTF-8'
          if(body.contents) {
            listing = body.contents.reduce(function(m, item) {
              var itemName = item.path.split('/').slice(-1)[0] + ( item.is_dir ? '/' : '' );
              if(item.is_dir){
                m[itemName] = revCache.get(path+itemName);
              } else {
                m[itemName] = item.rev;
              }
              return m;
            }, {});
          }
          promise.fulfill(status, listing, mime, rev);
        }
      });
      return promise;
    },
    /**
     * Method : get(path, options)
     *   get compatible with wireclient
     *   checks for path in _revCache and decides based on that if file has changed
     *   calls _getDir if file is a directory
     *   calls share(path) afterwards to fill the _hrefCache
     **/
    get: function(path, options){
      console.log('dropbox.get', arguments);
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      path = cleanPath(path);
      var url = 'https://api-content.dropbox.com/1/files/auto' + path
      var promise = this._sharePromise(path)
      
      var savedRev = this._revCache.get(path)
      if(savedRev === null) { 
        //file was deleted server side
        console.log(path,' deleted 404')
        promise.fulfill(404);
        return promise;
      }
      if(options && options.ifNoneMatch && 
         savedRev && (savedRev == options.ifNoneMatch)) {
        // nothing changed.
        console.log("nothing changed for",path,savedRev, options.ifNoneMatch)
        promise.fulfill(304);
        return promise;
      }
      
      //use _getDir for directories 
      if(path.substr(-1) == '/') return this._getDir(path, options);

      this._request('GET', url, {}, function(err, resp){
        if(err) {
          promise.reject(err);
        } else {
          var status = resp.status;
          var meta, body, mime, rev;
          if(status == 404){
            promise.fulfill(404);
          } else if(status == 200){
            body = resp.responseText;
            try {
              meta = JSON.parse( resp.getResponseHeader('x-dropbox-metadata') );
            } catch(e) {
              promise.reject(e);
              return;
            }
            mime = meta.mime_type//resp.getResponseHeader('Content-Type');
            rev = meta.rev;
            this._revCache.set(path, rev);
            
            // handling binary
            if((! resp.getResponseHeader('Content-Type') ) || resp.getResponseHeader('Content-Type').match(/charset=binary/)) {
              var blob = new Blob([resp.response], {type: mime});
              var reader = new FileReader();
              reader.addEventListener("loadend", function() {
                // reader.result contains the contents of blob as a typed array
                promise.fulfill(status, reader.result, mime, rev);
              });
              reader.readAsArrayBuffer(blob);

            } else {
              // handling json (always try)
              if(mime && mime.search('application/json') >= 0 || true) {
                try {
                  body = JSON.parse(body);
                  mime = 'application/json; charset=UTF-8'
                } catch(e) {
                  RS.log("Failed parsing Json, assume it is something else then", mime, path); 
                }
              }
              promise.fulfill(status, body, mime, rev);
            }
          
          } else {
            promise.fulfill(status);
          }
        }
      });
      return promise;
    },
    /** 
     * Method : put(path, body, contentType, options)
     *   put compatible with wireclient
     *   also uses _revCache to check for version conflicts
     *   also shares via share(path)
     **/
    put: function(path, body, contentType, options){      
      console.log('dropbox.put', arguments);
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      path = cleanPath(path);
      
      var promise = this._sharePromise(path);

      var revCache = this._revCache;

      //check if file has changed and return 412
      var savedRev = revCache.get(path)
      if(options && options.ifMatch &&  savedRev && (savedRev !== options.ifMatch) ) {
        promise.fulfill(412);
        return promise;
      }
      if(! contentType.match(/charset=/)) {
        contentType += '; charset=' + ((body instanceof ArrayBuffer || RS.WireClient.isArrayBufferView(body)) ? 'binary' : 'utf-8');
      }
      var url = 'https://api-content.dropbox.com/1/files_put/auto' + path + '?'
      if(options && options.ifMatch) {
        url += "parent_rev="+encodeURIComponent(options.ifMatch)
      }
      if(body.length>150*1024*1024){ //FIXME actual content-length
        //https://www.dropbox.com/developers/core/docs#chunked-upload
        console.log('files larger than 150MB not supported yet')
      } else { 
        this._request('PUT', url, {body:body, headers:{'Content-Type':contentType}}, function(err, resp) {
          if(err) {
            promise.reject(err)
          } else {
            var response = JSON.parse(resp.responseText);
            // if dropbox reports an file conflict they just change the name of the file
            // TODO find out which stays the origianl and how to deal with this
            if(response.path != path){
              promise.fulfill(412);
              this.rs.log('Dropbox created conflicting File ', response.path)
            }
            else
              revCache.set(path, response.rev);
              promise.fulfill(resp.status);
          }
        })
      }
      return promise;
    },
    /**
     * Method : delete(path, options)
     *   similar to get and set
     **/
    'delete': function(path, options){
      console.log('dropbox.delete ', arguments);
      if(! this.connected) throw new Error("not connected (path: " + path + ")");
      path = cleanPath(path);
      
      var promise = promising();
      var revCache = this._revCache;
      //check if file has changed and return 412
       var savedRev = revCache.get(path)
      if(options.ifMatch && savedRev && (options.ifMatch != savedRev)) {
        promise.fulfill(412);
        return promise;
      }

      var url = 'https://api.dropbox.com/1/fileops/delete?root=auto&path='+encodeURIComponent(path);
      this._request('POST', url, {}, function(err, resp){
        if(err) {
          promise.reject(error)
        } else {
          promise.fulfill(resp.status);
          revCache.delete(path);
        }
      })
      
      return promise.then(function(){
        var args = Array.prototype.slice.call(arguments);
        delete this._itemRefs[path]
        var p = promising();
        return p.fulfill.apply(p, args);
      }.bind(this))
    },
    /**
     * Method : _sharePromise(path)
     *   returns a promise which's then block doesn't touch the arguments given 
     *   and calls share for the path
     * 
     *  also checks for necessity of shareing this url(already in the itemRefs or not '/public/')
     **/
    _sharePromise: function(path){
      var promise = promising();
      var self = this
      if(path.match(/^\/public\/.*[^\/]$/) && typeof this._itemRefs[path] == 'undefined'){
        console.log('shareing this one ', path);
        promise.then(function(){
          var args = Array.prototype.slice.call(arguments);
          var p = promising()
          console.log('calling share now')
          self.share(path).then(function(){
            console.log('shareing fullfilled promise',arguments);
            p.fulfill.apply(p,args);
          }, function(err){
            console.log("shareing failed" , err);
            p.fulfill.apply(p,args);
          });
          return p;
        });
      }
      return promise;
    },

    /**
     * Method : share(path)
     *   get sher_url s from dropbox and pushes those into this._hrefCache
     *   returns promise
     */
    share: function(path){
      var url = "https://api.dropbox.com/1/media/auto"+path
      var promise = promising();
      var itemRefs = this._itemRefs
      
      // requesting shareing url
      this._request('POST', url, {}, function(err, resp){
        if(err) {
          console.log(err)
          err.message = 'Shareing Dropbox Thingie("'+path+'") failed' + err.message;
          promise.reject(err)
        } else {
          try{
            var response = JSON.parse(resp.responseText)
            var url = response.url;
            itemRefs[path] = url;
            console.log("SHAREING URL :::: ",url,' for ',path);
            if(haveLocalStorage)
              localStorage[SETTINGS_KEY+":shares"] = JSON.stringify(this._itemRefs);
            promise.fulfill(url);
          }catch(err) {
            err.message += "share error"
            promise.reject(err);
          }
        }
      });
      return promise;
    },

    /**
     * Method : info()
     *   fetching user info from Dropbox returns promise
     **/
    info: function() {
      var url = 'https://api.dropbox.com/1/account/info'
      var promise = promising();
      // requesting user info(mainly for userAdress)
      this._request('GET', url, {}, function(err, resp){
        if(err) {
          promise.reject(err);
        } else {
          try {
            var info = JSON.parse(resp.responseText)
            promise.fulfill(info);
          } catch(e) {
            promise.reject(err);
          }
        }
      })
      return promise;
    },
    _request: function(method, url, options, callback) {
      callback = callback.bind(this);
      if(! options.headers) options.headers = {};
      options.headers['Authorization'] = 'Bearer ' + this.token;
      RS.WireClient.request.call(this, method, url, options, function(err, xhr) {
        //503 means retry this later
        if(xhr && xhr.status == 503) {
          global.setTimeout(this._request(method, url, options, callback), 3210);
        } else {
          callback(err, xhr);
        }
      });
    },

    /**
    * method: fetchDelta
    *
    *   this method fetches the deltas from the dropbox api, used to sync the storage
    *   here we retrive changes and put them into the _revCache, those values will then be used 
    *   to determin if something has changed.
    **/
    fetchDelta: function() {
      var args = Array.prototype.slice.call(arguments);
      var promise = promising();
      var self = this;
      this._request('POST', 'https://api.dropbox.com/1/delta', {
        body: this._deltaCursor ? ('cursor=' + encodeURIComponent(this._deltaCursor)) : '',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }, function(error, response) {
        if(error) {
          this.rs.log('fetchDeltas',error);
          this.rs._emit('error', new RemoteStorage.SyncError('fetchDeltas failed'+error));
          promise.reject(error);
        } else {
          // break if status != 200
          if(response.status != 200 ){
            if(response.status == 400) {
              this.rs._emit('error', new RemoteStorage.Unauthorized());
              promise.fulfill.apply(promise, args)
            } else {
              console.log("!!!!dropbox.fetchDelta returned "+response.status+response.responseText);
              promise.reject("dropbox.fetchDelta returned "+response.status+response.responseText);
            }
            return promise;
          }

          try {
            var delta = JSON.parse(response.responseText);
          } catch(error) {
            RS.log('fetchDeltas can not parse response',error)
            return promise.reject("can not parse response of fetchDelta : "+error.message);
          }
          // break if no entries found
          if(!delta.entries){
            console.log("!!!!!DropBox.fetchDeltas() NO ENTRIES FOUND!!", delta);
            return promise.reject('dropbox.fetchDeltas failed, no entries found');
          }

          // Dropbox sends the complete state
          if(delta.reset) {
            this._revCache = new LowerCaseCache('rev');
            promise.then(function(){
              var args = Array.prototype.slice.call(arguments);
              self._revCache._activatePropagation();
              var p = promising();
              return p.fulfill.apply(p,args);
            });
          }
          
          //saving the cursor for requesting further deltas in relation to the cursor position
          if(delta.cursor)
            this._deltaCursor = delta.cursor;
          
          //updating revCache
          console.log("Delta : ",delta.entries);
          delta.entries.forEach(function(entry) {
            var path = entry[0];
            var rev;
            if(!entry[1]){
              rev = null;
            } else {
              if(entry[1].is_dir)
                return;
              rev = entry[1].rev;
            }
            self._revCache.set(path, rev);
          });
          promise.fulfill.apply(promise, args);
        }
      });
      return promise;
    }
  };

  //hooking and unhooking the sync

  function hookSync(rs) {
    if(rs._dropboxOrigSync) return; // already hooked
    rs._dropboxOrigSync = rs.sync.bind(rs);
    rs.sync = function() {
      return this.dropbox.fetchDelta.apply(this.dropbox, arguments).
        then(rs._dropboxOrigSync, function(err){
          rs._emit('error', new rs.SyncError(err));
        });
    };
  }
  function unHookSync(rs) {
    if(! rs._dropboxOrigSync) return; // not hooked
    rs.sync = rs._dropboxOrigSync;
    delete rs._dropboxOrigSync;
  }
  
  // hooking and unhooking getItemURL

  function hookGetItemURL(rs) {
    if(rs._origBaseClientGetItemURL)
      return;
    rs._origBaseClientGetItemURL = RS.BaseClient.prototype.getItemURL;
    RS.BaseClient.prototype.getItemURL = function(path){
      var ret = rs.dropbox._itemRefs[path];
      return  ret ? ret : '';
    }
  }
  function unHookGetItemURL(rs){
    if(! rs._origBaseClieNtGetItemURL)
      return;
    RS.BaseClient.prototype.getItemURL = rs._origBaseClietGetItemURL;
    delete rs._origBaseClietGetItemURL;
  }
  function hookRemote(rs){
    if(rs._origRemote)
      return;
    rs._origRemote = rs.remote;
    rs.remote = rs.dropbox;
  }
  function unHookRemote(rs){
    if(rs._origRemote) {
      rs.remote = rs._origRemote;
      delete rs._origRemote
    }
  }
  function hookIt(rs){
    hookRemote(rs);
    if(rs.sync) {
      hookSync(rs);
    }
    hookGetItemURL(rs);
  }
  function unHookIt(rs){
    unHookRemote(rs);
    unHookSync(rs);
    unHookGetItemURL(rs);
  }
  RS.Dropbox._rs_init = function(rs) {
    if( rs.apiKeys.dropbox ) {
      rs.dropbox = new RS.Dropbox(rs);
    }
    if(rs.backend == 'dropbox'){
      hookIt(rs);
    }
  };

  RS.Dropbox._rs_supported = function() {
    haveLocalStorage = 'localStorage' in global;
    return true;
  };

  RS.Dropbox._rs_cleanup = function(rs) {
    unHookIt(rs);
    if(haveLocalStorage){
      delete localStorage[SETTINGS_KEY];
    }
    rs.setBackend(undefined);
  };
})(this);

remoteStorage = new RemoteStorage();