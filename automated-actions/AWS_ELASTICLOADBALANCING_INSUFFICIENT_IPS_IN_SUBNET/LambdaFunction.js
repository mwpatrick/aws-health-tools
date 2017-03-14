// Sample Lambda Function to remove unattached ENIs in the subnets of the ELB when AWS Health AWS_ELASTICLOADBALANCING_INSUFFICIENT_IPS_IN_SUBNET events are generated. 
'use strict';
var AWS = require('aws-sdk');
const dryRun = ((process.env.DRY_RUN || 'true') == 'true');
const maxEniToProcess = process.env.MAX_ENI || 100;
var ec2 = null; // scoping object so both functions can see it

//main function which gets AWS Health data from Cloudwatch event
exports.handler = (event, context, callback) => {
    var eventName = event.detail.eventTypeCode;
    var region = event.region;
    const awsHealthSuccessMessage = `Successfully got details from AWS Health event, ${eventName} and executed automated action.`;

	AWS.config.update({region: region});
    ec2 = new AWS.EC2();
	var clb = new AWS.ELB();
	var alb = new AWS.ELBv2();

    var affectedEntities = event.detail.affectedEntities;
	console.log ('Event contains %s load balancers; determining associated subnets', affectedEntities.length);

	// The event could have Classic Load Balancers or Application Load Balancers. 
	// At this time both are presented the same way (short name)
	// Because of this, we'll query both APIs for the name provided in the event.
    var promises = [];
	for ( var i=0; i < affectedEntities.length; i+=1 )
    {
        var elbName = affectedEntities[i].entityValue;
		console.log('Making ALB promise for ',elbName);
		promises.push(alb.describeLoadBalancers({
			LoadBalancerArns: [elbName]
		}).promise());
			
		console.log('Making CLB promise for ',elbName);
		promises.push(clb.describeLoadBalancers({
			LoadBalancerNames: [elbName]
		}).promise());
    }
	
	var subnets = [];
	Promise.all(promises).then(function(values) {
			for ( var i=0; i < values.length; i+=1)
			{
				var subnet;
				if (values[i].LoadBalancerDescriptions)
				{
					for (var j=0; j < values[i].LoadBalancerDescriptions[0].Subnets.length; j+=1)
					{
						subnet = values[i].LoadBalancerDescriptions[0].Subnets[j];
						if (subnets.indexOf(subnet) === -1)	subnets.push(subnet);
					}
				} else {
					for (j=0; j < values[i].LoadBalancers[0].AvailabilityZones.length; j+=1)
					{
						subnet = values[i].LoadBalancers[0].AvailabilityZones[j].SubnetId;
						if (subnets.indexOf(subnet) === -1)	subnets.push(subnet);
					}
				}
			}
			
			if (subnets.length > 0)
			{
				var params = {
					Filters: [
							{Name: 'status',Values: ['available']},
							{Name: 'subnet-id',Values: subnets}
					]
				};

				console.log ('Getting the list of available ENI in the subnets %s', subnets);
				ec2.describeNetworkInterfaces(params, function(err, data) {
					if (err) console.log( region, err, err.stack);
					else 
					{
			            var numberToProcess = data.NetworkInterfaces.length;
						if ((maxEniToProcess > 0) && (data.NetworkInterfaces.length > maxEniToProcess)) numberToProcess = maxEniToProcess;
						console.log('Found %s available ENI; processing %s',data.NetworkInterfaces.length,numberToProcess);
						
						for ( var i=0; i < numberToProcess; i+=1) { 
							deleteNetworkInterface(data.NetworkInterfaces[i].NetworkInterfaceId,dryRun); 
						}
						
						callback(null, awsHealthSuccessMessage);
					}
				});
			}
			else
			{
				console.log('No subnets were found - did the event actually have ELBs?');
			}
		}
	).catch(function(err) {
		console.log(err);
	});
};

//This function removes an ENI
function deleteNetworkInterface (networkInterfaceId, dryrun) {
    console.log ('Running code to delete ENI %s with Dry Run set to %s', networkInterfaceId, dryrun);
    var deleteNetworkInterfaceParams = {
        NetworkInterfaceId: networkInterfaceId,
        DryRun: dryrun
    };
    ec2.deleteNetworkInterface(deleteNetworkInterfaceParams, function(err, data) {
        if (err) 
        {
            switch (err.code)
            {
                case 'DryRunOperation':
                    console.log('Dry run attempt complete for %s after %s retries', networkInterfaceId, this.retryCount);
                    break;
                case 'RequestLimitExceeded':
                    console.log('Request limit exceeded while processing %s after %s retries', networkInterfaceId, this.retryCount);
                    break;
                default:
                    console.log(networkInterfaceId, err, err.stack);    
            }
        }
        else console.log('ENI %s deleted after %s retries', networkInterfaceId, this.retryCount);  // successful response
    });
}