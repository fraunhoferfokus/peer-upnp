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
var UUID = require("node-uuid");
var os = require("os");
var http = require("http");
var server = http.createServer();
var PORT = 8082;
server.listen(PORT);

var peer = upnp.createPeer({
	prefix: "/upnp",
	server: server
}).on("ready",function(peer){
	console.log("ready");

	peer.on("urn:schemas-upnp-org:service:SwitchPower:1",function(service){
		console.log(">>>>>> service found for st ",service.serviceType);
		service.on("disappear",function(service){
			console.log("service "+service.serviceType+" disappeared");
		});
		service.bind(function(service){
			service.SetTarget({
				NewTargetValue: 1
			},function(res){
				console.log(res);
			});
		}).on("event",function(data){
			console.log(data);
		});
		setTimeout(function(){
			service.removeAllListeners("event");
		},5000);
	});
	
	peer.on("upnp:rootdevice",function(device){
		device.on("disappear",function(device){
			console.log("rootdevice "+device.UDN+" disappeared");
		});
		console.log("***** rootdevice "+device.UDN+" found for st","upnp:rootdevice");
	});
}).on("close",function(peer){
	console.log("closed");
}).start();

setTimeout(function(){
	peer.close();
	//peer.removeDevice("6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988");
},10000);


var device = peer.createDevice({
	//uuid: UUID.v4(),
	autoAdvertise: false,
	uuid: "6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988",
	productName: "Famium",
	productVersion: "0.0.1",
	domain: "famium-org",
	type: "MouseReceiver",
	version: "1",
	friendlyName: "X201",
	manufacturer: "Fraunhofer FOKUS",
	manufacturerURL: "http://www.fokus.fraunhofer.de",
	modelName: "MouseReceiver",
	modelDescription: "Mouse Receiver",
	modelNumber: "0.0.1",
	modelURL: "http://www.famium.org",
	serialNumber: "1234-1234-1234-1234",
	UPC: "123456789012",
	icons:[{
		mimetype: "image/png",
		width: 32,
		height: 32,
		depth: 8,
		url: "/images/icon.png"
	}]
});

var service = device.createService({
	domain: "famium-org",
	type: "Pong",
	version: "1",
	implementation: {
		join: function(inputs){return {token: "abc", paddle: "left"}},
		pause: function(){},
		resume: function(){},
		reset: function(){},
		getScore: function(){return {left: 1, right:2}},
		getState: function(){return {state: "paused"}},
		move: function(inputs){}
	},
	description: {
		actions: {
			join: {
				inputs: {
					name: "PlayerName"
				},
				outputs: {
					token: "AccessToken",
					paddle: "Paddle"
				}
			},
			pause: {},
			resume: {},
			reset: {},
			getScore: {
				outputs: {
					left: "Score",
					right: "Score"
				}
			},
			getState: {
				outputs: {
					state: "State"
				}
			},
			move: {
				inputs: {
					token: "AccessToken",
					speed: "PaddleSpeed"
				}
			}
		},
		variables: {
			PlayerName: "string",
			AccessToken: "string",
			Paddle: {
				type: "string",
				enum: ["left","right"]
			},
			Score: {
				type: "int",
				range: {
					min: 0,
					max: 10,
					step: 1
				},
				event: true,
				multicast: true
			},
			State: {
				type: "string",
				enum: ["paused","running","finished"],
				event: true,
				multicast: true
			},
			PaddleSpeed: {
				type: "float",
				range: {
					min: -1.0,
					max: 1.0
				}
			}
		}
	}
});
device.advertise();
