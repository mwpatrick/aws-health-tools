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

    var affectedEntities = event.detail.affectedEntities;
	console.log ('Event contains %s load balancers; determining associated subnets', affectedEntities.length);

	
	// The event could have Classic Load Balancers and Application Load Balancers
	// There is not presently a way to determine from the event which type it 
	// references so we will check for Classic and then Application.
    var promises = [];
	for ( var i=0; i < affectedEntities.length; i+=1 )
    {
        var elbName = affectedEntities[i].entityValue;
		if (elbName.startsWith("app/"))
		{
			console.log("Making ALB promise for ",elbName);
			var elbArn = affectedEntities[i].entityArn;
			promises.push(alb.describeLoadBalancers({
				LoadBalancerArns: [elbArn]
			}).promise());
			
		} else {
			console.log("Making CLB promise for ",elbName);
			promises.push(clb.describeLoadBalancers({
				LoadBalancerNames: [elbName]
			}).promise());
		}
    }
	
	// Once all the async calls are done, we need to populate the list of subnets
	// For each ELB, determine subnets
	// add subnets to array	
	var subnets = [];
	Promise.all(promises).then(function(values) {
			for ( var i=0; i < values.length; i+=1)
			{
				// CLB and ALB provide different outputs from the searches
				var subnet;
				if (values[i].LoadBalancerDescriptions)
				{
					console.log("LBName: ", values[i].LoadBalancerDescriptions[0].LoadBalancerName);
					console.log("Subnets: ", values[i].LoadBalancerDescriptions[0].Subnets);
					for (var j=0; j < values[i].LoadBalancerDescriptions[0].Subnets.length; j+=1)
					{
						subnet = values[i].LoadBalancerDescriptions[0].Subnets[j];
						if (subnets.indexOf(subnet) === -1)
						{
							console.log("Adding %s to subnets array", subnet);
							subnets.push(subnet);
						}
					}
				} else {
					console.log("LBName: ", values[i].LoadBalancers[0].LoadBalancerName);
					console.log("Subnets: ", values[i].LoadBalancers[0].AvailabilityZones ); 	
					for (j=0; j < values[i].LoadBalancers[0].AvailabilityZones.length; j+=1)
					{
						subnet = values[i].LoadBalancers[0].AvailabilityZones[j].SubnetId;
						if (subnets.indexOf(subnet) === -1)
						{
							console.log("Adding %s to subnets array", subnet);
							subnets.push(subnet);
						}
					}
				}
			}
			
			// build API call filter for available ENIs in the right subnets
			if (subnets.length > 0)
			{
				var params = {
					Filters: [
							{Name: 'status',Values: ['available']},
							{Name: 'subnet-id',Values: subnets}
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
		}
	).catch(function(err) {
		console.log(err);
	});
	
    callback(null, awsHealthSuccessMessage); //return success
};

//This function removes an available (unattached) ENI
//Take an instance description as argument so we can verify attachment status
function deleteNetworkInterface (networkInterface, region) {
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