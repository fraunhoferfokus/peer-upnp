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

var upnp = require("../lib/peer-upnp");
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
			this.get("Target") == "1"? console.log("Change Light to ON"):console.log("Change Light to OFF");
		},
		GetStatus: function(inputs){
			// the result is the value of the state variable Target
			return {ResultStatus: this.get("Target")}
		}
	},
	// Service Description. this will be converted to XML 
	description: {
		actions: {
			GetTarget: {
				outputs: {
					RetTargetValue: "Target" // Target is the name of the state variable
				}
			},
			SetTarget: {
				inputs: {
					NewTargetValue: "Target"
				}
			},
			GetStatus: {
				outputs: {
					ResultStatus: "Status"
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


