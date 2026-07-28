// services/aws.js
// ------------------------------------------------------------------
// Handles the actual "provisioning.sh" step shown in the storefront's
// terminal animation: launch a Windows EC2 instance, wait for it to
// be running, pull the auto-generated Administrator password, and
// hand back everything the customer needs to connect over RDP.
// ------------------------------------------------------------------
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  GetPasswordDataCommand,
  TerminateInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
  CreateTagsCommand,
} from "@aws-sdk/client-ec2";
import crypto from "crypto";

const ec2 = new EC2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Decrypts the Windows Administrator password returned by AWS using the
 * private half of the EC2 key pair (PEM). AWS encrypts it with the public
 * half at launch time, so only someone holding the private key can read it.
 */
function decryptPassword(encryptedPasswordBase64, privateKeyPem) {
  const buffer = Buffer.from(encryptedPasswordBase64, "base64");
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return decrypted.toString("utf-8");
}

/**
 * Launches a Windows instance sized for the given plan and returns
 * { instanceId } immediately. Call pollUntilReady() separately so the
 * HTTP request that triggered this doesn't have to block for minutes.
 */
export async function launchServer({ plan, orderId }) {
  const cmd = new RunInstancesCommand({
    ImageId: process.env.AWS_WINDOWS_AMI_ID,
    InstanceType: plan.awsInstanceType,
    KeyName: process.env.AWS_KEY_PAIR_NAME,
    MinCount: 1,
    MaxCount: 1,
    SecurityGroupIds: [process.env.AWS_SECURITY_GROUP_ID],
    SubnetId: process.env.AWS_SUBNET_ID,
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/sda1",
        Ebs: { VolumeSize: plan.storageGB, VolumeType: "gp3" },
      },
    ],
    TagSpecifications: [
      {
        ResourceType: "instance",
        Tags: [
          { Key: "Name", Value: `nodrix-${orderId}` },
          { Key: "nodrix:orderId", Value: orderId },
        ],
      },
    ],
  });

  const result = await ec2.send(cmd);
  const instanceId = result.Instances[0].InstanceId;
  return { instanceId };
}

/**
 * Polls AWS until the instance is running AND the Windows password
 * material is available (this can take a few minutes on a fresh
 * Windows boot), then decrypts and returns connection details.
 * Intended to run in the background after launchServer().
 */
export async function pollUntilReady(instanceId, { timeoutMs = 8 * 60 * 1000 } = {}) {
  const started = Date.now();

  // 1. Wait for the instance to report "running" and get its public IP.
  let publicIp = null;
  while (!publicIp) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for instance to run");
    const desc = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const instance = desc.Reservations[0]?.Instances[0];
    if (instance?.State?.Name === "running" && instance.PublicIpAddress) {
      publicIp = instance.PublicIpAddress;
    } else {
      await sleep(10_000);
    }
  }

  // 2. Wait for GetPasswordData to return a non-empty payload (Windows
  //    needs a few minutes after boot to generate + encrypt it).
  let encryptedPassword = null;
  while (!encryptedPassword) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for password data");
    const pw = await ec2.send(new GetPasswordDataCommand({ InstanceId: instanceId }));
    if (pw.PasswordData) {
      encryptedPassword = pw.PasswordData;
    } else {
      await sleep(15_000);
    }
  }

  // 3. Decrypt using the private key that matches AWS_KEY_PAIR_NAME.
  //    Store this PEM outside of git — env var or a secrets manager.
  const privateKeyPem = process.env.AWS_KEY_PAIR_PRIVATE_PEM;
  const password = decryptPassword(encryptedPassword, privateKeyPem);

  return {
    publicIp,
    username: "Administrator",
    password,
  };
}

export async function terminateServer(instanceId) {
  await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
}

/**
 * Stops (but does not delete) the instance. Billing for compute stops;
 * the attached disk is preserved, so the customer's data and OS state
 * survive. Used when a subscription lapses but is still within the
 * renewal grace period.
 */
export async function stopServer(instanceId) {
  await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
}

/**
 * Restarts a previously-stopped instance — used when a customer renews
 * before the grace period runs out. Note: EC2 assigns a NEW public IP
 * on restart unless an Elastic IP is attached, so the caller should
 * re-fetch and store the fresh IP afterwards.
 */
export async function startServer(instanceId) {
  await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
}

/**
 * Reads the current public IP — call after startServer() since restarting
 * a stopped instance changes its IP (unless it has an Elastic IP).
 */
export async function getPublicIp(instanceId) {
  const desc = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
  return desc.Reservations[0]?.Instances[0]?.PublicIpAddress || null;
}

export async function tagServer(instanceId, tags) {
  await ec2.send(
    new CreateTagsCommand({
      Resources: [instanceId],
      Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
    })
  );
}
