// Sample Lambda Function to remove unattached ENIs in the subnets of the ELB when AWS Health AWS_ELASTICLOADBALANCING_INSUFFICIENT_IPS_IN_SUBNET events are generated. 
// This is useful for situations where you might have leftover ENIs tying up IP addresses that are not used and are preventing load balancer scaling
'use strict';
var AWS = require('aws-sdk');

//main function which gets AWS Health data from Cloudwatch event
exports.handler = (event, context, callback) => {
    //extract details from Cloudwatch event
    var eventName = event.detail.eventTypeCode;
    var region = event.region;
    const awsHealthSuccessMessage = `Successfully got details from AWS Health event, ${eventName} and executed automated action.`;

	// the event could have multiple load balancers listed but this does not matter here
	// ultimately we only need to run this automation once per invocation since the issue 
	// of ENI exhaustion is regional and not dependent on the load balancers in the alert
	// Event will only trigger for one region so we don't have to loop that
	AWS.config.update({region: region});
    var ec2 = new AWS.EC2();
	var clb = new AWS.ELB();
	var alb = new AWS.ELBv2();
	console.log ('End of object creation');
	
	// For each ELB, determine subnets
	// add subnets to array	
	var subnets = [];
	console.log ('BEFORE var entities');
    var affectedEntities = event.detail.affectedEntities;
	console.log ('AFTER var entities');
	console.log ('Event contains %s load balancers; determining associated subnets', affectedEntities.length);

	
    for ( var i=0; i < affectedEntities.length; i+=1 )
    {
        var elbName = affectedEntities[i].entityValue;
		if (elbName == "Testing") {
			// determine subnets for ALB
		} else {
			// determine subnets for ELB
		}
    }
	
	// build API call filter for subnets
	if (subnets.length > 0)
	{
		var params = {
			Filters: [
					{Name: 'status',Values: ['available']},
					{Name: 'subnet-id',Values: [subnets.join(",")]}
			]
		};

		// query API to get available ENIs in the subnets
		// walk the result, deleting available ENIs
		console.log ('Getting the list of available ENI in the subnets %s', subnets);
		ec2.describeNetworkInterfaces(params, function(err, data) {
			if (err) console.log( region, err, err.stack); // an error occurred
			else 
			{
				console.log("Found %s available ENI",data.NetworkInterfaces.length); // successful response
				// for each interface, remove it
				for ( var i=0; i < data.NetworkInterfaces.length; i+=1) deleteNetworkInterface(data.NetworkInterfaces[i], region);
			}
		});
	}
	else
	{
		console.log("No subnets were found - did the event actually have ELBs?");
	}
	
    callback(null, awsHealthSuccessMessage); //return success
};

//This function removes an available (unattached) ENI
//Take an instance description as argument so we can verify attachment status
function deleteNetworkInterface (networkInterface, region) {
    AWS.config.update({region: region});
    var ec2 = new AWS.EC2();
	
	if (networkInterface.Status == "available") {
		console.log ('Attempting to delete the following ENI: %s', networkInterface.NetworkInterfaceId);
		var deleteNetworkInterfaceParams = {
			NetworkInterfaceId: networkInterface.NetworkInterfaceId,
			DryRun: false
		};
		ec2.deleteNetworkInterface(deleteNetworkInterfaceParams, function(err, data) {
			if (err) console.log(networkInterface.NetworkInterfaceId, region, err, err.stack); // an error occurred
			else console.log("ENI deleted: %s", networkInterface.NetworkInterfaceId);           // successful response
		});
	}
	else console.log ('The following ENI is not in an available (unattached) state: %s', networkInterface.NetworkInterfaceId);
}