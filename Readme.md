peer-upnp 
=========

peer-upnp is a Node.js module implementing the UPnP protocol as described in the [UPnP Device Architecture specification](http://www.upnp.org/specs/arch/UPnP-arch-DeviceArchitecture-v1.1.pdf)

Setup
=====

  * use `npm install peer-upnp` to install the module.
  * run `binary light` example:
     1. use `node node_modules/peer-upnp/test/binary-light-device.js` to create and advertise a UPnP `BinaryLight` Device with `SwitchPower` service
     2. use `node node_modules/peer-upnp/test/binary-light-client.js` that discovers `BinaryLight` devices and uses `SwitchPower` Service to control the light.
  * or run the other example using `node node_modules/peer-upnp/test/upnp-test.js` to discover UPnP services on the network.

Usage
=====

The following example shows the discovery and binding process of UPnP devices and services.

```javascript
var upnp = require("peer-upnp");
var http = require("http");
var server = http.createServer();
var PORT = 8080;
server.listen(PORT);
// Peer is an event emitter
var peer = upnp.createPeer({
	prefix: "/upnp",
	server: server
}).on("ready",function(peer){
	console.log("ready");
	// listen to urn:schemas-upnp-org:service:SwitchPower:1 services
	peer.on("urn:schemas-upnp-org:service:SwitchPower:1",function(service){
		console.log("service "+service.serviceType+" found");
		service.on("disappear",function(service){
			console.log("service "+service.serviceType+" disappeared");
		});
		// Bind to service to be able to call service actions
		service.bind(function(service){
			// Call UPnP action SetTarget with parameter NewTargetValue
			service.SetTarget({
				NewTargetValue: 1
			},function(res){
				console.log("Result",res);
			});
		}).on("event",function(data){
			console.log((data.Status == "1" || data.Status == "true")? "Light is ON": "Light is OFF" );
		});
		// unsubscribe from the service after 10 seconds 
		setTimeout(function(){
			service.removeAllListeners("event");
		},10000);
	}).on("upnp:rootdevice",function(device){ // listen to root devices
		console.log("rootdevice "+device.deviceType+" found");
		device.on("disappear",function(device){
			console.log("rootdevice "+device.UDN+" disappeared");
		});
	});
	// close peer after 30 seconds
	setTimeout(function(){
		peer.close();
	},30000);
}).on("close",function(){
	console.log("closed");
});
```

The following example shows how to create and advertise a BinaryLight device and with a SwitchPower service as specified in [UPnP Lighting Controls V 1.0](http://upnp.org/specs/ha/lighting/). Please refer to the documentation in the code.

```javascript
var upnp = require("peer-upnp");
var http = require("http");
var server = http.createServer();
var PORT = 8080;
// start server on port 8080. please do this step before you create a peer
server.listen(PORT);

// Create a UPnP Peer. 
var peer = upnp.createPeer({
	prefix: "/upnp",
	server: server
}).on("ready",function(peer){
	console.log("ready");
	// advertise device after peer is ready
	device.advertise();
}).on("close",function(peer){
	console.log("closed");
}).start();

// Create a BinaryLight device as specified in UPnP http://upnp.org/specs/ha/UPnP-ha-BinaryLight-v1-Device.pdf.  
// Please refer for device configuration parameters to the UPnP device architecture.
var device = peer.createDevice({
	autoAdvertise: false,
	uuid: "6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988",
	productName: "Coltram",
	productVersion: "0.0.1",
	domain: "schemas-upnp-org",
	type: "BinaryLight",
	version: "1",
	friendlyName: "BinaryLight",
	manufacturer: "Fraunhofer FOKUS",
	manufacturerURL: "http://www.fokus.fraunhofer.de",
	modelName: "BinaryLight",
	modelDescription: "BinaryLight",
	modelNumber: "0.0.1",
	modelURL: "http://www.famium.org",
	serialNumber: "1234-1234-1234-1234",
	UPC: "123456789012"
});

// create a SwitchPower service in the BinaryLight device as specified here http://upnp.org/specs/ha/UPnP-ha-SwitchPower-v1-Service.pdf
var service = device.createService({
	domain: "schemas-upnp-org",
	type: "SwitchPower",
	version: "1",
	// Service Implementation
	implementation: {
		GetTarget: function(inputs){
			// the result is the value of the state variable Target
			return {RetTargetValue: this.get("Target")}
		},
		SetTarget: function(inputs){
			// set the new value of the state variable Target
			this.set("Target", inputs.NewTargetValue); 
			// notify state change of the state variable to all subscribers
			this.notify("Target");
			this.get("Target") == "1"? console.log("Light is ON"):console.log("Light is OFF");
		},
		GetStatus: function(inputs){
			// the result is the value of the state variable Target
			return {ResultStatus: this.get("Target")}
		},
	},
	// Service Description. this will be converted to XML 
	description: {
		actions: {
			GetTarget: {
				outputs: {
					RetTargetValue: "Target", // Target is the name of the state variable
				}
			},
			SetTarget: {
				inputs: {
					NewTargetValue: "Target"
				}
			},
			GetStatus: {
				outputs: {
					ResultStatus: "Status",
				}
			}
		},
		// declare all state variables: key is the name of the variable and value is the type of the variable. 
		// type can be JSON object in this form {type: "boolean"}. 
		variables: {
			Target: "boolean", 
			Status: "boolean"
		}
	}
});
// initialize the Target State Variable with 0
service.set("Target",0);
```

License
=======

Free for non commercial use released under the GNU Lesser General Public License v3.0, See LICENSE file.

Contact us for commecial use famecontact@fokus.fraunhofer.de

Copyright (c) 2013 Fraunhofer FOKUS
