/*******************************************************************************
 * 
 * Copyright (c) 2013 Louay Bassbouss, Fraunhofer FOKUS, All rights reserved.
 * 
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3.0 of the License, or (at your option) any later version.
 * 
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>. 
 * 
 * AUTHORS: Louay Bassbouss (louay.bassbouss@fokus.fraunhofer.de)
 *     Martin Lasak (martin.lasak@fokus.fraunhofer.de)
 *     Alexander Futasz (alexander.futasz@fokus.fraunhofer.de)
 *
 ******************************************************************************/
 
var os = require('os');
var fs = require('fs');
var ejs = require('ejs');
var events = require('events');
var xml2js = require("xml2js");
var URL = require('url');
var http = require('http');
var util = require('util');
var UUID = require('node-uuid');
var ssdp = require('peer-ssdp');
//var ssdp = require('ssdp');
var ROOT_DEVICE = "upnp:rootdevice";
var UPNP_VERSION = "UPnP/1.1";
var OS_NAME = os.type() || "unknown";
var OS_VERSION = os.release() || "0.0";
var INTERVAL = 10000;
var DEVICE_TEMPLATE = fs.readFileSync(__dirname + '/../xml/device-desc.xml', 'utf8');
var SERVICE_TEMPLATE = fs.readFileSync(__dirname + '/../xml/service-desc.xml', 'utf8');
var SOAP_REQ_TEMPLATE = fs.readFileSync(__dirname + '/../xml/soap-req.xml', 'utf8');
var SOAP_RSP_TEMPLATE = fs.readFileSync(__dirname + '/../xml/soap-rsp.xml', 'utf8');
var EVENT_TEMPLATE = fs.readFileSync(__dirname + '/../xml/event.xml', 'utf8');
var RENDER_DEVICE = ejs.compile(DEVICE_TEMPLATE);
var RENDER_SERVICE = ejs.compile(SERVICE_TEMPLATE);
var RENDER_SOAP_REQ = ejs.compile(SOAP_REQ_TEMPLATE);
var RENDER_SOAP_RSP = ejs.compile(SOAP_RSP_TEMPLATE);
var RENDER_EVENT = ejs.compile(EVENT_TEMPLATE);

var SSDP_ALL = "ssdp:all";
var UPnPError = function(message,code) {
	Error.call(this);
	Error.captureStackTrace(this, this.constructor);
	this.name = "UPnPError";
	this.message = message;
	this.code = parseInt(code) || 0;
};
util.inherits(UPnPError, Error);

var createPeer = function(options){
	options = options || {};
	var peer = new Peer(options);
	return peer;
};

var Peer = function(options){
	var self = this;
	this.prefix = options.prefix || "";
	this.server = options.server || null;
	this.hostname = options.hostname || getHostname();
	this.port = options.port || (this.server && this.server.address() && this.server.address().port);
	this.interval = null;
	this.devices = {};
	this.remoteDevices = {};
	this.ssdpPeer = ssdp.createPeer();
	this.ssdpPeer.on("notify",function(headers, address){
		var nts = headers['NTS'];
		var nt = headers['NT'];
		var usn = headers['USN'] || '';
		var udn = usn.split("::")[0];
		if (nts == ssdp.ALIVE) {
			if (!self.remoteDevices[udn] && (self.listeners(SSDP_ALL).length>0 || self.listeners(nt).length>0)) {
				var location = headers['LOCATION'];
				self.remoteDevices[udn] = new RemoteDevice(self,{
					descriptionUrl: location,
					UDN: udn
				});
				self.remoteDevices[udn].bind(function(device){
					for ( var i in device.services) {
						var service = device.services[i];
						self.emit(SSDP_ALL,service);
						self.emit(service.serviceType,service);
					}
					self.emit(SSDP_ALL,device);
					self.emit(device.deviceType,device);
					self.emit(device.UDN,device);
					if (nt == ROOT_DEVICE) {
						self.emit(ROOT_DEVICE,device);
					}
				});
			}
		}
		else if (nts == ssdp.BYEBYE){
			var device = self.remoteDevices[udn];
			if (device) {
				delete self.remoteDevices[udn];
				for ( var i in device.services) {
					var service = device.services[i];
					service.emit("disappear",service);
				}
				device.emit("disappear",device);
			}
		}
	}).on("search",function(headers, address){
		var st = headers['ST'];
		respond(st,self,address);
	}).on("found",function(headers, address){
		var nts = headers['NTS'];
		var st = headers['ST'];
		var usn = headers['USN'] || '';
		var udn = usn.split("::")[0];
		if (!self.remoteDevices[udn] && (self.listeners(SSDP_ALL).length>0 || self.listeners(st).length>0)) {
			var location = headers['LOCATION'];
			self.remoteDevices[udn] = new RemoteDevice(self,{
				descriptionUrl: location,
				UDN: udn
			});
			self.remoteDevices[udn].bind(function(device){
				for ( var i in device.services) {
					var service = device.services[i];
					self.emit(SSDP_ALL,service);
					self.emit(service.serviceType,service);
				}
				self.emit(SSDP_ALL,device);
				self.emit(device.deviceType,device);
				self.emit(device.UDN,device);
				if (st == ROOT_DEVICE) {
					self.emit(ROOT_DEVICE,device);
				}
			});
		}
	}).on("ready",function(){
		notify(ssdp.ALIVE,self);
		self.interval = setInterval(function(){
			notify(ssdp.ALIVE,self);
		},INTERVAL);
		self.emit("ready",self);
	}).on("close",function(){
		clearInterval(self.interval);
		self.interval = null;
		self.emit("close",self);
	});
	this.on("newListener",function(event, listener){
		if (event == SSDP_ALL || event == ROOT_DEVICE || event.indexOf("urn:") == 0 || event.indexOf("uuid:") == 0) {
			this.ssdpPeer.search({
				ST: event
			});
		}
	});
	if (this.server) {
		registerHTTPHandler(this);
	}
};
util.inherits(Peer, events.EventEmitter);

Peer.prototype.start = function(){
	if (this.ssdpPeer && !this.interval) {
		this.ssdpPeer.start();
	}
	return this;
};

Peer.prototype.close = function(){
	unregisterHTTPHandler(this);
	var self = this;
	clearInterval(this.interval);
	this.interval = null;
	notify(ssdp.BYEBYE,this);
	setTimeout(function(){
		self.ssdpPeer && self.ssdpPeer.close();
		self.ssdpPeer = null;
	},1000);
};

Peer.prototype.createDevice = function(options){
	options = options || {};
	options.root = true;
	var device = new Device(this,options);
	this.devices[device.uuid] = device;
	if (device.available === true) {
		device.advertise();
	}
	return device;
};

Peer.prototype.removeDevice = function(uuid){
	if (this.devices[uuid]) {
		notify(ssdp.BYEBYE,this,this.devices[uuid]);
		delete this.devices[uuid];
	}
};

var createStub = function(controlUrl,serviceType, actionName){
	var stub = function(inputs, callback){
		var options = {
			inputs: inputs,
			serviceType: serviceType,
			actionName: actionName
		};
		var soap = RENDER_SOAP_REQ(options);
		var url = URL.parse(controlUrl);
		var opt = {
			host: url.hostname,
			port: url.port,
			path: url.path,
			method: 'POST',
			headers: {
				'CONTENT-TYPE': 'text/xml; charset="utf-8"',
				'SOAPACTION': '"'+serviceType+"#"+actionName+'"'
			}
		};
		if (typeof callback == "function") {
			httpRequest(opt, soap, function(err, xml) {
                if(err){
                    var result = new UPnPError("HTTP Request Error:"+(err.message ||""));
                    callback.call(null,result);
                    return;
                }
				xml2js.parseString(xml,{mergeAttrs: true, explicitArray: false, ignoreXmlns: true, ignoreAttrs: true},function(err,json){
					var result;
					if (err) {
						result = new UPnPError("Response is not a valide XML message:"+(err.message ||""));
					}
					else {
						try {
							result = json && json.Envelope && json.Envelope.Body && json.Envelope.Body[actionName+"Response"];
							if (typeof result == "undefined") {
								throw new Error();
							}
							if (typeof result == "string") {
								result = {};
							}
						} catch (e) {
							try {
								err = json.Envelope.Body.Fault.detail.UPnPError || {};
								result = new UPnPError(err.errorDescription, err.errorCode);
							} catch (e) {
								result = new UPnPError("Response is not a valide uPnP/SOAP message");
							}
						}
					}
					callback.call(null,result);
				});
			});
		}
	};
	return stub;
};

/*Peer.prototype.bindDevice = function(descUrl, callback){
	var client = rest(descUrl);
	client.then(function(rsp) {
		xml2js.parseString(rsp.entity, {explicitArray: false, ignoreXmlns: true, mergeAttrs: true},function (err, json) {
			var options = json.root.device;
			if (typeof callback == "function") {
				callback.call(null, new RemoteDevice(descUrl,options));
			}
	    });
	});
};*/

var Device = function(peer, options){
	this.peer = peer;
	this.root = (options.root === true);
	this.available = (options.autoAdvertise === true);
	this.uuid = options.uuid || UUID.v4();
	this.domain = options.domain || null;
	this.type = options.type || null;
	this.version = options.version || "1";
	this.productName = options.productName || "unknown";
	this.productVersion = options.productVersion || "0.0";
	this.server = OS_NAME+"/"+OS_VERSION+" "+UPNP_VERSION+" "+this.productName+"/"+this.productVersion;
	this.deviceType = options.deviceType || ("urn:"+(this.domain || "")+":device:"+(this.type || "")+":"+this.version);
	this.friendlyName = options.friendlyName || null;
	this.manufacturer = options.manufacturer || null;
	this.manufacturerURL = options.manufacturerURL || null;
	this.modelDescription = options.modelDescription || null;
	this.modelName = options.modelName || null;
	this.modelNumber = options.modelNumber || null;
	this.modelURL = options.modelURL || null;
	this.serialNumber = options.serialNumber || null;
	this.UDN = "uuid:"+this.uuid;
	this.UPC = options.UPC|| null;
	this.presentationURL = options.presentationURL || null;
	this.descriptionURL = this.peer.prefix+"/device/desc.xml?udn="+this.uuid;
	this.icons = options.icons || [];
	this.configId = 1;
	this.services = {};
	this.devices = {};
};

Device.prototype.advertise = function(){
	this.available = true;
	notify(ssdp.ALIVE,this.peer,this);
};

Device.prototype.createService = function(options){
	options = options || {};
	var service = new Service(this,options);
	this.services[service.serviceType] = service;
	return service;
};
Device.prototype.removeService = function(serviceType){
	delete this.services[serviceType];
};

var Service = function(device, options){
	this.device = device;
	this.domain = options.domain || this.device.domain || null; 
	this.type = options.type || null;
	this.version = options.version || "1";
	this.serviceId = options.serviceId || ("urn:"+(this.domain || "")+":serviceId:"+(this.type || ""));
	this.serviceType = options.serviceType || ("urn:"+(this.domain || "")+":service:"+(this.type||"")+":"+(this.version || ""));
	this.description = options.description || null;
	this.USN = this.device.uuid+"::"+this.serviceType;
	this.SCPDURL = this.device.peer.prefix + "/service/desc.xml?usn="+this.USN;
	this.controlURL = this.device.peer.prefix + "/service/control?usn="+this.USN;
	this.eventSubURL = this.device.peer.prefix + "/service/events?usn="+this.USN;
	this.configId = 1;
	this.implementation = options.implementation || null;
	this.state = {};
	this.subscriptions = {};
};

Service.prototype.set = function(name,value){
	this.state[name] = value;
};

Service.prototype.get = function(name){
	return this.state[name];
};

Service.prototype.notify = function(){
	var names = arguments;
	var variables = {};
	if (names.length == 0) {
		variables = this.state;
	}
	else {
		for ( var i = 0; i < names.length; i++) {
			var name = names[i];
			variables[name] = this.state[name];
		}
	}
	var options = {
		variables: variables
	};
	var xml = RENDER_EVENT(options);
	for ( var sid in this.subscriptions) {
		var subscription = this.subscriptions[sid];
		var callbacks = subscription.callbacks;
		for ( var i = 0; i < callbacks.length; i++) {
			var callback = callbacks[i];
			var url = URL.parse(callback);
			var req = http.request({
				host: url.hostname,
				port: url.port,
				path: url.path,
				method: 'NOTIFY',
				headers: {
					HOST: url.host,
					'CONTENT-TYPE': 'text/xml; charset="utf-8"',
					NT: "upnp:event",
					NTS: 'upnp:propchange',
					SID: sid,
					SEQ: subscription.seq
				}
			});
			req.end(xml,'utf8');
		}
		subscription.seq++;
	}
};

var RemoteDevice = function(peer,options){
	this.peer = peer;
	this.descriptionUrl = options.descriptionUrl || null;
	this.deviceType = options.deviceType || null;
	this.UDN = options.UDN || null;
};
util.inherits(RemoteDevice, events.EventEmitter);

RemoteDevice.prototype.bind = function(callback){
	var self = this;
	httpRequest(this.descriptionUrl, function(err, data) {
		if (err) {
			console.error("err: failed to get device description");
			return;
		}
		xml2js.parseString(data, {explicitArray: false, ignoreXmlns: true, mergeAttrs: true},function (err, json) {
			if (err || !json) return;
			var options = json.root.device;
			self.deviceType = options.deviceType || null;
			self.friendlyName = options.friendlyName || null;
			self.manufacturer = options.manufacturer || null;
			self.manufacturerURL = options.manufacturerURL || null;
			self.modelDescription = options.modelDescription || null;
			self.modelName = options.modelName || null;
			self.modelNumber = options.modelNumber || null;
			self.modelURL = options.modelURL || null;
			self.serialNumber = options.serialNumber || null;
			self.UDN = options.UDN || null;
			self.UPC = options.UPC || null;
			self.icons = [];
			var iconList = options.iconList && options.iconList.icon || [];
			iconList = iconList instanceof Array? iconList: [iconList];
			for ( var i in iconList) {
				var icon = iconList[i];
				icon.url = URL.resolve(self.descriptionUrl, icon.url);
				self.icons.push(icon);
			}
			self.services = {};
			var serviceList = options.serviceList && options.serviceList.service || [];
			serviceList = serviceList instanceof Array? serviceList: [serviceList];
			
			for ( var i in serviceList) {
				var options = serviceList[i];
				options.SCPDURL = URL.resolve(self.descriptionUrl, options.SCPDURL);
				options.controlURL = URL.resolve(self.descriptionUrl, options.controlURL);
				options.eventSubURL = URL.resolve(self.descriptionUrl, options.eventSubURL);
				
				var service = new RemoteService(self,options);
				self.services[service.serviceType] = service;
			}
			if (typeof callback == "function") {
				callback.call(null, self);
			}
		});
	});
};

RemoteDevice.prototype.getService = function(serviceType){
	return this.services && this.services[serviceType];
};

var RemoteService = function(device, options){
	this.device= device;
	this.configId = options.configId || null;
	this.serviceId = options.serviceId || null;
	this.serviceType = options.serviceType || null;
	this.USN = device.UDN+"::"+this.serviceType;
	this.SCPDURL = options.SCPDURL || null;
	this.controlURL = options.controlURL || null;
	this.eventSubURL = options.eventSubURL || null;
	this.actions = null;
	this.variables = null;
	this.timeoutHandle = null;
	
	this.on("newListener",function(event, listener){
		if (event == "event" && this.listeners("event") == 0) {
			subscribe(this);
		}
	});
	this.on("removeListener",function(event, listener){
		if (event == "event" && this.listeners("event") == 0) {
			unsubscribe(this);
		}
	});
};
util.inherits(RemoteService, events.EventEmitter);
RemoteService.prototype.bind = function(callback){
	var self = this;
	if (this.actions) {
		callback.call(null, this.actions);
	} else {
		this.actions = {};
		this.variables = {};
		httpRequest(this.SCPDURL, function(err, data) {
			xml2js.parseString(data, {explicitArray: false, ignoreXmlns: true, mergeAttrs: true}, function (err, json) {
			    var proxy = {};
			    proxy.SCPD = json && json.scpd || {};
				var variables = json && json.scpd && json.scpd.serviceStateTable && json.scpd.serviceStateTable.stateVariable || [];
				variables = variables instanceof Array? variables: [variables];
				for ( var i = 0; i < variables.length; i++) {
					var stateVariable = variables[i];
					var variable = {
						name: stateVariable.name,
						type: stateVariable.dataType,
						default: stateVariable.defaultValue,
						events: (typeof stateVariable.sendEvents == "undefined") || stateVariable.sendEvents == "yes",
						multicast:  stateVariable.multicast == "yes"
					};
					var allowedValues = stateVariable.allowedValueList && stateVariable.allowedValueList.allowedValue;
					if (allowedValues) {
						variable.enum = allowedValues instanceof Array? allowedValues: [allowedValues];
					}
					var allowedValueRange = stateVariable.allowedValueRange;
					if (allowedValueRange) {
						variable.range = {
							min: allowedValueRange.minimum,
							max: allowedValueRange.maximum,
							step: allowedValueRange.step
						};
					}
					self.variables[variable.name] = variable;
					proxy[variable.name] = variable;
				}
				var actions = json && json.scpd && json.scpd.actionList && json.scpd.actionList.action || [];
				actions = actions instanceof Array? actions: [actions];
				for ( var i = 0; i < actions.length; i++) {
					var action = actions[i];
					var actionName = action.name;
					var stub = createStub(self.controlURL, self.serviceType,actionName);
					stub.name = actionName;
					stub.inputs = {};
					stub.outputs = {};
					var arguments = action.argumentList && action.argumentList.argument || [];
					arguments = arguments instanceof Array? arguments: [arguments];
					for ( var j = 0; j < arguments.length; j++) {
						var argument = arguments[j];
						if (argument.direction == "in") {
							stub.inputs[argument.name] =  argument.relatedStateVariable;
						}
						else if (argument.direction == "out") {
							stub.outputs[argument.name] =  argument.relatedStateVariable;
						}
					}
					self.actions[actionName] = stub;
					proxy[actionName] = stub;
				}
				if (typeof callback == "function") {
					callback.call(null, proxy);
				}
		    });
		});
	}
	return this;
};

var subscribe = function(service){
	var peer = service.device.peer;
	var port = peer.server && peer.server.address().port;
	var eventSubURL = service.eventSubURL;
	var url = URL.parse(eventSubURL);
	var req = http.request({
		host: url.hostname,
		port: url.port,
		path: url.path,
		method: 'SUBSCRIBE',
		headers: {
			HOST: url.host,
			CALLBACK: "<http://"+peer.hostname+":"+port+peer.prefix+"/events?usn="+service.USN+">", 
			NT: "upnp:event"
		}
	},function(rsp){
		var sid = rsp.headers['sid'];
		var timeout = rsp.headers['timeout'];
		timeout = timeout && parseInt(timeout.replace("Second-","")) || 1800;
		service.sid = sid;
		clearTimeout(service.timeoutHandle);
		service.timeoutHandle = setTimeout(function(){
			renew(service);
		},(timeout-1)*1000);
	});
	req.end();
};

var renew = function(service){
	if (service.sid) {
		var peer = service.device.peer;
		var port = peer.server && peer.server.address().port;
		var eventSubURL = service.eventSubURL;
		var url = URL.parse(eventSubURL);
		var req = http.request({
			host: url.hostname,
			port: url.port,
			path: url.path,
			method: 'SUBSCRIBE',
			headers: {
				HOST: url.host,
				SID: service.sid
			}
		},function(rsp){
			var timeout = rsp.headers['timeout'];
			timeout = timeout && parseInt(timeout.replace("Second-","")) || 1800;
			clearTimeout(service.timeoutHandle);
			service.timeoutHandle = setTimeout(function(){
				renew(service);
			},(timeout-1)*1000);
		});
		req.end();
	}
};

var unsubscribe = function(service){
	clearTimeout(service.timeoutHandle);
	service.timeoutHandle = null;
	if (service.sid) {
		var peer = service.device.peer;
		var port = peer.server && peer.server.address().port;
		var eventSubURL = service.eventSubURL;
		var url = URL.parse(eventSubURL);
		var req = http.request({
			host: url.hostname,
			port: url.port,
			path: url.path,
			method: 'UNSUBSCRIBE',
			headers: {
				HOST: url.host,
				SID: service.sid
			}
		},function(rsp){
			
		});
		req.end();
		service.sid = null;
	}
};
var registerHTTPHandler = function(peer){
	peer.server && peer.server.on("request", peer.httpHandler = function(req,rsp){
		var self = this;
		if (req) {
			var url = URL.parse(req.url,true);
			var method = req.method.toUpperCase();
			var isPeer = url.pathname.indexOf(peer.prefix) == 0;
		}
		else {
			var url = '/';
			var method = 'GET';
			var isPeer = false;
		}
		if (isPeer) {
			var path = url.pathname.substr(peer.prefix.length);
			var handler = httpHandlers[method+" "+path];
			if (typeof handler == "function") {
				req.path = path;
				req.query = url.query;
				req.data = '';
				req.setEncoding('utf8');
				req.on('data', function(chunk) { req.data += chunk;});
				req.on('end', function(){handler.call(self,req,rsp,peer)});
			}
			else {
				rsp.statusCode = 404;
				rsp.end("Not found");
			}
		}
	});
};
var unregisterHTTPHandler = function(peer){
	if (peer.server && peer.httpHandler) {
		peer.server.removeListener("request",peer.httpHandler);
		peer.httpHandler = null;
	}
};


var handleGetDeviceDescription = function(req,rsp,peer){
	var udn = req.query["udn"];
	var device = peer.devices[udn];
	if (device) {
		var xml = RENDER_DEVICE(device);
		rsp.setHeader('Content-Type','text/xml;charset=utf-8');
		rsp.end(xml,'utf8');
	} else {
		rsp.statusCode = 404;
		rsp.end("Device not found");
	}
};

var handleGetServiceDescription = function(req,rsp,peer){
	var usn = req.query["usn"] || "";
	var split = usn.split("::");
	if (split.length==2) {
		var udn = split[0];
		var serviceType = split[1];
		var device = peer.devices[udn];
		var service = device && device.services[serviceType];
		if (service) {
			var options = {
				actions: service.description && service.description.actions || {},
				variables: service.description && service.description.variables || {},
				configId: service.configId
			};
			var xml = RENDER_SERVICE(options);
			rsp.setHeader('Content-Type','text/xml;charset=utf-8');
			rsp.end(xml,'utf8');
		} else {
			rsp.statusCode = 404;
			rsp.end("Service not found");
		}
	}
	else {
		rsp.statusCode = 400;
		rsp.end("Parameter usn is missing or not valid");
	}
};

var handlePostControl = function(req,rsp,peer){
	var usn = req.query["usn"] || "";
	var split = usn.split("::");
	if (split.length==2) {
		var udn = split[0];
		var serviceType = split[1];
		var device = peer.devices[udn];
		var service = device && device.services[serviceType];
		var actionName = req.headers["SOAPACTION"] || req.headers["soapaction"];
		actionName = actionName && actionName.substring(actionName.lastIndexOf("#")+1,actionName.length-1);
		if (service && actionName) {
			xml2js.parseString(req.data,{mergeAttrs: true, explicitArray: false, ignoreXmlns: true, ignoreAttrs: true},function(err,json){
				if (err) {
					rsp.statusCode = 400;
					rsp.end("Request is not a valide XML message:"+(err.message ||""));
				}
				else {
					try {
						var inputs = json.Envelope.Body[actionName];
						if (typeof inputs == "undefined") {
							throw new Error();
						}
						if (typeof inputs == "string") {
							inputs = {};
						}
						var options = {
							serviceType: service.serviceType,
							actionName: actionName
						};
						
						try {
							options.outputs = service.implementation[actionName].call(service,inputs) || {};
						} catch (e) {
							options.error = new UPnPError(e.message,501);
						}
						var xml = RENDER_SOAP_RSP(options);
						rsp.setHeader('Content-Type','text/xml;charset=utf-8');
						rsp.end(xml,'utf8');
					} catch (e) {
						rsp.statusCode = 400;
						rsp.end("Request is not a valide uPnP/SOAP message",'utf8');
					}
				}
			});
		} else {
			rsp.statusCode = 404;
			rsp.end("Service or action not found",'utf8');
		}
	}
	else {
		rsp.statusCode = 400;
		rsp.end("Parameter usn is missing or not valid",'utf8');
	}
};

var handlePostEvent = function(req,rsp,peer){
	var usn = req.query["usn"] || "";
	var split = usn.split("::");
	if (split.length==2) {
		var udn = split[0];
		var serviceType = split[1];
		var device = peer.remoteDevices[udn];
		var service = device && device.services[serviceType];
		if (service) {
			xml2js.parseString(req.data,{mergeAttrs: true, explicitArray: false, ignoreXmlns: true},function(err,json){
				if (json) {
					var data = {};
					var props = json.propertyset && json.propertyset.property || [];
					props = props instanceof Array?props:[props];
					for ( var i = 0; i < props.length; i++) {
						var prop = props[i];
						for ( var key in prop) {
							data[key] = prop[key];
						}
					}
					service.emit("event",data);
                    rsp.end();
				}
                else {
                    rsp.statusCode = 400;
                    rsp.end("Request is not a valide XML message:"+(err && err.message ||""));
                }
			});
		}
        else {
            rsp.statusCode = 404;
            rsp.end("Service not found",'utf8');
        }
	}
    else {
        rsp.statusCode = 400;
        rsp.end("Parameter usn is missing or not valid",'utf8');
    }
};

var handleSubscribeEvent = function(req,rsp,peer){
	var usn = req.query["usn"] || "";
	var split = usn.split("::");
	if (split.length==2) {
		var udn = split[0];
		var serviceType = split[1];
		var device = peer.devices[udn];
		var service = device && device.services[serviceType];
		if (service) {
			var sid = "uuid:"+UUID.v4();
			var callbacks = req.headers.callback && req.headers.callback.replace(/[<|>]/g,"").split(",");
			service.subscriptions[sid] = {
					callbacks: callbacks,
					seq: 0
			};
			var timeout = req.headers.timeout || "Second-1800";
			rsp.setHeader('DATE',new Date().toUTCString());
			rsp.setHeader('SERVER',"win/5.1 UPnP/1.1 famium/0.0.1");
			rsp.setHeader('SID',sid);
			rsp.setHeader('CONTENT-LENGTH',0);
			rsp.setHeader('TIMEOUT',timeout);
		}
		else{
			rsp.statusCode = 404;
		}
	}
	else{
		rsp.statusCode = 400;
	}
	rsp.end();
};

var handleUnsubscribeEvent = function(req,rsp,peer){
	var usn = req.query["usn"] || "";
	var split = usn.split("::");
	if (split.length==2) {
		var udn = split[0];
		var serviceType = split[1];
		var device = peer.devices[udn];
		var service = device && device.services[serviceType];
		if (service) {
			var sid = req.headers.sid;
			delete service.subscriptions[sid];
		}
		else{
			rsp.statusCode = 404;
		}
	}
	else{
		rsp.statusCode = 400;
	}
	rsp.end();
};

var httpHandlers = {
	"GET /device/desc.xml": handleGetDeviceDescription,
	"GET /service/desc.xml": handleGetServiceDescription,
	"POST /service/control": handlePostControl,
	"NOTIFY /events": handlePostEvent,
	"SUBSCRIBE /service/events": handleSubscribeEvent,
	"UNSUBSCRIBE /service/events": handleUnsubscribeEvent
};

var notify = function(nts,peer,entity){
	var port = peer.port;
	if (!peer.ssdpPeer) {
		return;
	}
	var devices = peer.devices;
	if (entity instanceof Device) {
		devices = [entity];
	}
	for ( var i in devices) {
		var device = devices[i];
		if (device.available) {
			var headers = {
				//'LOCATION': "http://"+peer.hostname+":"+port+device.descriptionURL,
                'LOCATION': "http://{{networkInterfaceAddress}}:"+port+device.descriptionURL,
                'SERVER': device.server,
				'CONFIGID.UPNP.ORG': device.configId,
				'NTS': nts
			};
			headers['NT'] = ROOT_DEVICE;
			headers['USN'] = device.UDN+"::"+ROOT_DEVICE;
			peer.ssdpPeer.notify(headers);
			headers['NT'] = device.UDN;
			headers['USN'] = device.UDN;
			peer.ssdpPeer.notify(headers);
			headers['NT'] = device.deviceType;
			headers['USN'] = device.UDN+"::"+device.deviceType;
			peer.ssdpPeer.notify(headers);
			for ( var j in device.services) {
				var service = device.services[j];
				headers['NT'] = service.serviceType;
				headers['USN'] = device.UDN+"::"+service.serviceType;
				peer.ssdpPeer.notify(headers);
			}
		}
	}
};

var respond = function(st,peer,address){
	var port = peer.port;
	if (!peer.ssdpPeer) {
		return;
	}
	if (st == SSDP_ALL) {
		for ( var i in peer.devices) {
			var device = peer.devices[i];
			if (device.available) {
				var headers = {
					//'LOCATION': "http://"+peer.hostname+":"+port+device.descriptionURL,
                    'LOCATION': "http://{{networkInterfaceAddress}}:"+port+device.descriptionURL,
					'SERVER': device.server,
					'CONFIGID.UPNP.ORG': device.configId
				};
				headers['ST'] = ROOT_DEVICE;
				headers['USN'] = device.UDN+"::"+ROOT_DEVICE;
				peer.ssdpPeer.reply(headers,address);
				headers['ST'] = device.UDN;
				headers['USN'] = device.UDN;
				peer.ssdpPeer.reply(headers,address);
				headers['ST'] = device.deviceType;
				headers['USN'] = device.UDN+"::"+device.deviceType;
				peer.ssdpPeer.reply(headers,address);
				for ( var j in device.services) {
					var service = device.services[j];
					headers['ST'] = service.serviceType;
					headers['USN'] = device.UDN+"::"+service.serviceType;
					peer.ssdpPeer.reply(headers,address);
				}
			}
		}
	}
	else if(st == ROOT_DEVICE){
		for ( var i in peer.devices) {
			var device = peer.devices[i];
			if (device.available) {
				var headers = {
					//'LOCATION': "http://"+peer.hostname+":"+port+device.descriptionURL,
                    'LOCATION': "http://{{networkInterfaceAddress}}:"+port+device.descriptionURL,
					'SERVER': device.server,
					'CONFIGID.UPNP.ORG': device.configId,
					'ST': ROOT_DEVICE,
					'USN': device.UDN+"::"+ROOT_DEVICE
				};
				peer.ssdpPeer.reply(headers,address);
			}
		}
	}
	else {
		for ( var i in peer.devices) {
			var device = peer.devices[i];
			if (device.available) {
				var headers = {
					//'LOCATION': "http://"+peer.hostname+":"+port+device.descriptionURL,
                    'LOCATION': "http://{{networkInterfaceAddress}}:"+port+device.descriptionURL,
					'SERVER': device.server,
					'CONFIGID.UPNP.ORG': device.configId,
					'ST': st,
					'USN': device.UDN+"::"+ROOT_DEVICE
				};
				if (device.UDN == st) {
					headers['USN'] = device.UDN;
					peer.ssdpPeer.reply(headers,address);
				}
				else if(device.deviceType == st){
					headers['USN'] = device.UDN+"::"+device.deviceType;
					peer.ssdpPeer.reply(headers,address);
				}
				else {
					for ( var j in device.services) {
						var service = device.services[j];
						headers['USN'] = device.UDN+"::"+service.serviceType;
						peer.ssdpPeer.reply(headers,address);
					}
				}				
			}
		}
	}
};

var getHostname = function() {
	var interfaces = os.networkInterfaces();
	for ( var devName in interfaces) {
		var iface = interfaces[devName];
		for ( var i = 0; i < iface.length; i++) {
			var alias = iface[i];
			if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
				return alias.address;
		}
	}
	return '0.0.0.0';

    // this update allows the SSDP module to replace the {{networkInterfaceAddress}} placeholder with the actual
    // IP Address of the corresponding Network Interface. In the old implementation the same address is used
    // for all network interfaces. The old implementation is commented and will be removed in future releases
    // return "{{networkInterfaceAddress}}";
};

var httpRequest = function(/* options, body, callback */) {
	var options, body, callback;
	options = arguments[0];
	if (arguments.length === 3) {
		body = arguments[1];
		callback = arguments[2];
	}
	else if (arguments.length < 3 && typeof arguments[1] === "function") {
		callback = arguments[1];
	}

	var req = http.request(options, function(rsp) {
		var buffers = [];
		rsp.on("data", function (data) {
			buffers.push(data)
		});
		rsp.on("end", function() {
			var err, data = buffers.length > 0 ? Buffer.concat(buffers).toString("utf8") : "";
			if (rsp.statusCode >=400) {
				err = true;
			}
			callback && callback(err, data);
		});
	}).on("error", function(error) {
        var err = true;
        callback && callback(err);
    }).on('timeout', function () {
        req.abort();
    });
    req.setTimeout(2000);
	if (body) {
		req.end(body);
	} else {
		req.end();
	}
};

exports.createPeer = createPeer;
exports.UPnPError = UPnPError;
