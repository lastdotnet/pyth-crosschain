import { IgnoreMode } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export type BackendProps = {
  cluster: ecs.ICluster;
  service: string;
  containerEnvironment?: { [key: string]: string };
  containerSecrets?: { [key: string]: ecs.Secret };
  inlineRolePolicies?: iam.RoleProps["inlinePolicies"];
  vpc: ec2.IVpc;
};

export class Backend extends Construct {
  public readonly service: ecs.FargateService;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: BackendProps) {
    super(scope, id);

    const { cluster, inlineRolePolicies = {}, vpc } = props;

    const pricePusherSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "price-pusher-secret",
      "price-pusher/config"
    );

    // Create a security group for the services
    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      "ServiceSecurityGroup",
      {
        vpc,
        description: "Security group for backendservices",
        allowAllOutbound: true,
      }
    );

    // Create roles for the services
    this.role = new iam.Role(this, `${id}-role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
      inlinePolicies: {
        ...inlineRolePolicies,
      },
    });

    const taskDefinition = new ecs.TaskDefinition(this, "api", {
      family: props.service,
      compatibility: ecs.Compatibility.EC2_AND_FARGATE,
      cpu: "1024",
      memoryMiB: "2048",
      networkMode: ecs.NetworkMode.AWS_VPC,
      taskRole: this.role,
    });

    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [pricePusherSecret.secretArn],
      })
    );

    const image = ecs.ContainerImage.fromAsset("./", {
      file: "Dockerfile.cdk",
      buildArgs: {
        SERVICE: props.service,
      },
      ignoreMode: IgnoreMode.DOCKER,
    });

    taskDefinition.addContainer(`${id}-backend`, {
      image,
      memoryLimitMiB: 2048,
      environment: {
        ...props.containerEnvironment,
        ENDPOINT: "https://rpc.hyperliquid.xyz/evm",
        PRICE_SERVICE_ENDPOINT: "https://hermes.pyth.network",
        PYTH_CONTRACT_ADDRESS: "0xe9d69CdD6Fe41e7B621B4A688C5D1a68cB5c8ADc",
        PRICE_CONFIG_FILE: "./price-config.hypurr.yaml",
        ENABLE_METRICS: "false",
      },
      secrets: {
        PRIVATE_KEY: ecs.Secret.fromSecretsManager(pricePusherSecret, "PRIVATE_KEY"),
      },
      command: [
        "/bin/sh",
        "-c",
        "echo $PRIVATE_KEY > ./mnemonic && npm start -- evm --endpoint $ENDPOINT --price-service-endpoint $PRICE_SERVICE_ENDPOINT --pyth-contract-address $PYTH_CONTRACT_ADDRESS --enable-metrics $ENABLE_METRICS --mnemonic-file ./mnemonic --price-config-file $PRICE_CONFIG_FILE --log-level warn",
      ],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "hypurr-price-pusher",
        logRetention: logs.RetentionDays.THREE_DAYS,
      }),
      essential: true,
    });

    // Create the main service with service discovery
    this.service = new ecs.FargateService(this, `${id}-service`, {
      cluster: cluster,
      serviceName: "price-pusher",
      taskDefinition: taskDefinition,
      securityGroups: [serviceSecurityGroup],
      assignPublicIp: false,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      desiredCount: 1,
      circuitBreaker: {
        rollback: false,
      },
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
    });
  }
}
