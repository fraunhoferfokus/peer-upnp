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
var PORT = 8081;
server.listen(PORT);

var peer = upnp.createPeer({
	prefix: "/upnp",
	server: server
}).on("ready",function(peer){
	console.log("ready");
    // search for SwitchPower UPnP Devices
	peer.on("urn:schemas-upnp-org:service:SwitchPower:1",function(service){
		console.log("SwitchPower service found");
        // get notified when device disappears
		service.on("disappear",function(service){
			console.log("service "+service.serviceType+" disappeared");
		});
        // bind to the service in order to call its methods
        // bind will generate a JavaScript function for each service method.
        // Inputs and outputs are JSON objects where the keys are the name of the
        // inputs or outputs.
		service.bind(function(service){
            // Call UPnP interface SetTarget of SwitchPower Service
            console.log("Turn light ON using SetTarget with input parameter NewTargetValue=1");
			service.SetTarget({
				NewTargetValue: 1
			},function(res){
				console.log("SetTarget done");
			});
		}).on("event",function(data){
			console.log("Receive update from SwitchPower Service: ",data);
		});
        // Stop receiving updates after 10 seconds
		setTimeout(function(){
			//service.removeAllListeners("event");
		},10000);
	});

}).on("close",function(peer){
	console.log("closed");
}).start();

// close peer after 3 minutes
setTimeout(function(){
	//peer.close();
},180000);