import * as cdk from "aws-cdk-lib";
import { IVpc, Vpc } from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";

export class Cluster extends cdk.Stack {
  public readonly cluster: ecs.ICluster;
  public readonly vpc: IVpc;

  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = Vpc.fromLookup(this, "imported-hypurr-liquidator-network", {
      vpcId: "vpc-01e44f96507b5ea1b",
    });

    this.cluster = ecs.Cluster.fromClusterAttributes(
      this,
      "imported-hypurr-liquidator-cluster",
      {
        clusterName: "hypurr-liquidator-cluster",
        vpc: this.vpc,
      }
    );
  }
}
