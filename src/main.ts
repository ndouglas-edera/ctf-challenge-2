import "./style.css";
import "./edera-chrome.css";

interface Pod {
  name: string;
  namespace: string;
  app: string;
  node: string;
  status: string;
  privileged: boolean;
  allowPrivilegeEscalation?: boolean;
  runtimeClass: string | null;
  annotations: Record<string, string>;
  zone: string | null;
  image: string;
}

interface Zone {
  name: string;
  id: string;
  state: "ready" | "failed";
  cpus: number;
  memory: string;
  kernel: string;
  pod: string;
  failure?: string[];
}

interface CachedImage {
  reference: string;
  digest: string;
  format: string;
  size: string;
}

interface KernelVariant {
  name: string;
  image: string;
  notes: string;
}

const NODE = {
  name: "worker-02",
  status: "Ready",
  kernelVersion: "6.1.0-edera-host",
  os: "Ubuntu 20.04 LTS",
  runtime: "containerd://1.7.13",
  capacityMemory: "16Gi",
  allocatableMemory: "14Gi",
  ip: "10.10.0.12",
  labels: {
    "kubernetes.io/hostname": "worker-02",
    "kubernetes.io/os": "linux",
    "kubernetes.io/arch": "amd64",
    "node-role.kubernetes.io/worker": "",
    "edera.dev/runtime": "edera",
  },
};

/* K04 namespace onboarding; defined early because startup manifests are applied below. */
const ONBOARDING_KEY = "edera.dev/isolation";
const ONBOARDING_VALUE = "enforced";
const ONBOARDING_POLICY = "edera-tenant-onboarding";
const ONBOARDING_RULE = "require-onboarded-namespace";
const BLOCKED_NAMESPACE = "customer-e";

const namespaceLabels: Record<string, Record<string, string>> = {
  ...Object.fromEntries(
    ["default", "customer-a", "customer-b", "customer-c", "customer-d", "platform"].map(
      (namespace) => [namespace, { [ONBOARDING_KEY]: ONBOARDING_VALUE }],
    ),
  ),
  [BLOCKED_NAMESPACE]: { team: BLOCKED_NAMESPACE },
};

const ZONE_KERNEL = "ghcr.io/edera-dev/zone-kernel:6.15";
const ZONE_KERNEL_EBPF = "ghcr.io/edera-dev/zone-kernel:6.15-ebpf";
const ZONE_KERNEL_NVIDIA = "ghcr.io/edera-dev/zone-kernel:6.15-nvidia";

const pods: Pod[] = [
  {
    name: "image-processor-a",
    namespace: "customer-a",
    app: "image-processor",
    node: NODE.name,
    status: "Running",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "2048",
    },
    zone: "zone-customer-a",
    image: "ghcr.io/acme/image-processor:1.4.2",
  },
  {
    name: "billing-api-b",
    namespace: "customer-b",
    app: "billing-api",
    node: NODE.name,
    status: "Running",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "2048",
    },
    zone: "zone-customer-b",
    image: "ghcr.io/acme/billing-api:3.0.1",
  },
  {
    name: "edera-ebpf-test",
    namespace: "platform",
    app: "ebpf-test",
    node: NODE.name,
    status: "Running",
    privileged: true,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel-variant": "ebpf",
      "dev.edera/initial-memory-request": "2048",
    },
    zone: "zone-ebpf-test",
    image: "ubuntu:latest",
  },
  {
    name: "analytics-batch-d",
    namespace: "customer-d",
    app: "analytics-batch",
    node: NODE.name,
    status: "Running",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "4096",
    },
    zone: "zone-analytics-d",
    image: "ghcr.io/acme/analytics-batch:0.9.0",
  },
  {
    /*
     * The finding: this workload explicitly permits privilege escalation.
     * It still runs in an Edera zone, so the exercise is about workload
     * hardening rather than a missing RuntimeClass.
     */
    name: "recommendation-c",
    namespace: "customer-c",
    app: "recommendation",
    node: NODE.name,
    status: "Running",
    privileged: false,
    allowPrivilegeEscalation: true,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "2048",
    },
    zone: "zone-recommendation-c",
    image: "ghcr.io/acme/recommendation:2.2.0",
  },
];

const zones: Zone[] = [
  {
    name: "zone-customer-a",
    id: "z-7f1a44",
    state: "ready",
    cpus: 2,
    memory: "2048MB",
    kernel: ZONE_KERNEL,
    pod: "image-processor-a",
  },
  {
    name: "zone-customer-b",
    id: "z-2b90c7",
    state: "ready",
    cpus: 2,
    memory: "2048MB",
    kernel: ZONE_KERNEL,
    pod: "billing-api-b",
  },
  {
    name: "zone-ebpf-test",
    id: "z-c53de1",
    state: "ready",
    cpus: 2,
    memory: "2048MB",
    kernel: ZONE_KERNEL_EBPF,
    pod: "edera-ebpf-test",
  },
  {
    name: "zone-analytics-d",
    id: "z-9ea022",
    state: "ready",
    cpus: 4,
    memory: "4096MB",
    kernel: ZONE_KERNEL,
    pod: "analytics-batch-d",
  },
];

zones.push({
  name: "zone-recommendation-c",
  id: "z-5a81c2",
  state: "ready",
  cpus: 2,
  memory: "2048MB",
  kernel: ZONE_KERNEL,
  pod: "recommendation-c",
});

/*
 * The arrays above are the lab's initial cluster state. `kubectl apply -f`
 * and `kubectl delete -f` mutate the live state below, while the manifest
 * files themselves remain on the node so they can be applied again.
 */
const podTemplates = new Map<string, Pod>(
  pods.map((pod) => [
    pod.name,
    {
      ...pod,
      annotations: { ...pod.annotations },
    },
  ]),
);

const zoneTemplates = new Map<string, Zone>(
  zones.map((zone) => [
    zone.name,
    {
      ...zone,
      failure: zone.failure ? [...zone.failure] : undefined,
    },
  ]),
);

/*
 * Workloads that ship as raw manifests in ~/manifests and are applied with
 * the same code path as `kubectl apply -f` before the lab starts. Their
 * pod/zone templates are registered here so the apply can wire up a zone,
 * but they are NOT in the initial arrays above: the boot-time apply is what
 * puts them into the live cluster state.
 */
const GPU_WORKLOAD_MANIFEST_PATH = "/home/ivy/manifests/gpu-workload.yaml";

const GPU_WORKLOAD_MANIFEST = [
  "apiVersion: v1",
  "kind: Pod",
  "metadata:",
  "  name: gpu-workload",
  "  annotations:",
  "    dev.edera/kernel-variant: nvidia",
  "spec:",
  "  runtimeClassName: edera",
  "  containers:",
  "    - name: workload",
  "      image: nvidia/cuda:13.3.0-devel-ubuntu26.04",
].join("\n");

podTemplates.set("gpu-workload", {
  name: "gpu-workload",
  namespace: "default",
  app: "workload",
  node: NODE.name,
  status: "Running",
  privileged: false,
  runtimeClass: "edera",
  annotations: {
    "dev.edera/kernel-variant": "nvidia",
  },
  zone: "zone-gpu-workload",
  image: "nvidia/cuda:13.3.0-devel-ubuntu26.04",
});

zoneTemplates.set("zone-gpu-workload", {
  name: "zone-gpu-workload",
  id: "z-4e8b10",
  state: "ready",
  cpus: 4,
  memory: "4096MB",
  kernel: ZONE_KERNEL_NVIDIA,
  pod: "gpu-workload",
});

const images: CachedImage[] = [
  {
    reference: ZONE_KERNEL,
    digest:
      "sha256:8c4f2a91d7e3b06547ac1fe920dd35b8746c0a29e1fb5d3c88ea47612d90bf5a",
    format: "squashfs",
    size: "94.2MB",
  },
  {
    reference: ZONE_KERNEL_EBPF,
    digest:
      "sha256:3d71e0b4c82a95f16de4470cb1a9d2385fe6c07b41da9e25837fbc60a4e12d7c",
    format: "squashfs",
    size: "108.6MB",
  },
  {
    reference: "ubuntu:latest",
    digest:
      "sha256:b1e4f0c73a2d58916cf0e27bd4a5390fd62c81ba7e0d3945cfa2610b8d47e93f",
    format: "squashfs",
    size: "78.1MB",
  },
  {
    reference: "docker.io/library/php:8.4-fpm-alpine",
    digest:
      "sha256:611a4485c8fbe49e9d8b11bb13375b46be6bca14902cb0b37e172eab9a97c021",
    format: "squashfs",
    size: "31.6MB",
  },
  {
    reference: "docker.io/library/php:7.4.33-apache",
    digest:
      "sha256:a766a07ccdc7b9dae4f45d0f811a7dfbd5845fe610514b313b3aba831fc7b44b",
    format: "squashfs",
    size: "163.9MB",
  },
  {
    reference: "ghcr.io/acme/image-processor:1.4.2",
    digest:
      "sha256:5a0c9f231e6b74d8ac35180fe9b2d764c1a83e05fd7b26943ce81b0a75f3d2e8",
    format: "squashfs",
    size: "221.4MB",
  },
  {
    reference: ZONE_KERNEL_NVIDIA,
    digest:
      "sha256:243be03aa10331842755b7e5c044aefb0c97978e8065d27d40aed4663094c900",
    format: "directory",
    size: "187.3MB",
  },
];

const kernelVariants: KernelVariant[] = [
  {
    name: "default",
    image: ZONE_KERNEL,
    notes: "standard zone kernel",
  },
  {
    name: "ebpf",
    image: ZONE_KERNEL_EBPF,
    notes: "BTF + BPF LSM enabled",
  },
  {
    name: "nvidia",
    image: ZONE_KERNEL_NVIDIA,
    notes: "NVIDIA GPU passthrough drivers",
  },
];

interface Stage {
  title: string;
  objective: string;
  brief: string[];
  /* Accepted answers, compared lowercase after trimming. */
  answers: string[];
  /* Wrong-but-close answers mapped to a nudge, compared lowercase. */
  nudges?: Record<string, string>;
  flag: string;
  reward: string[];
}

const K04_FLAG = "EDERA{K04_POLICY_ENFORCED}";
const K07_FLAG = "EDERA{K07_VULNERABLE_COMPONENT}";

const stages: Stage[] = [
  {
    title: "K01 · Insecure workload configurations",
    objective: "Find the pod that allows privilege escalation.",
    brief: ["Read more about Security Contexts: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/", "Submit the pod name."],
    answers: ["recommendation-c", "customer-c/recommendation-c"],
    flag: "EDERA{K01_INSECURE_WORKLOAD}",
    reward: ["`allowPrivilegeEscalation: true` permits a process to gain privileges beyond its parent, including through setuid programs.", "Set `allowPrivilegeEscalation: false` and apply a consistent workload security baseline."],
  },
  {
    title: "K02 · Overly-permissive authorisation",
    objective: "Find the service account bound to excessive permissions.",
    brief: ["Read up on RBAC good practices: https://kubernetes.io/docs/concepts/security/rbac-good-practices/", "Submit the affected service account."],
    answers: ["report-bot", "customer-b/report-bot", "system:serviceaccount:customer-b:report-bot"],
    flag: "EDERA{K02_EXCESSIVE_PERMISSIONS}",
    reward: ["RBAC should follow least privilege.", "Avoid wildcard and unnecessary cluster-wide permissions."],
  },
  {
    title: "K03 · Secrets management failures",
    objective: "Find the credential leaked in plaintext in a workload's logs.",
    brief: ["Read up on Secrets good practices: https://kubernetes.io/docs/concepts/security/secrets-good-practices/", "Submit the leaked secret value."],
    answers: ["bt-lab-7f3a9c2e5d1b", "billing_token=bt-lab-7f3a9c2e5d1b"],
    nudges: { "billing-api-token": "Close: that's the Secret's name. Submit the leaked value itself." },
    flag: "EDERA{K03_EXPOSED_SECRET}",
    reward: ["Anyone with `get` on `pods/log`, or access to your log platform, could read that token.", "Never log configuration or environment values; rotate the credential and restrict `pods/log` access."],
  },
  {
    title: "K04 · Lack of cluster-level policies",
    objective: "A tenant's workload is being blocked from starting. Find out why and get it running.",
    brief: ["Read up on Kyverno validate rules: https://release-1-18-0.kyverno.io/docs/policy-types/cluster-policy/validate/", "The flag is captured automatically once the workload is admitted."],
    answers: ["edera.dev/isolation=enforced"],
    flag: "EDERA{K04_POLICY_ENFORCED}",
    reward: ["edera-tenant-onboarding denied every Pod in customer-e until the namespace opted in.", "Once labelled, payments-worker was admitted and started in its own Edera zone.", "Enforce admission policy cluster-wide, rather than relying on convention."],
  },
  {
    title: "K05 · Missing network segmentation",
    objective: "One NetworkPolicy isn't protecting what its author intended. Find it.",
    brief: ["Read up on NetworkPolicies: https://kubernetes.io/docs/concepts/services-networking/network-policies/", "Submit the name of the misconfigured NetworkPolicy."],
    answers: ["billing-api-ingress", "customer-b/billing-api-ingress"],
    nudges: {
      "customer-b": "Right namespace. Which NetworkPolicy in it is misconfigured?",
      "biling-api": "That's the typo! Submit the name of the NetworkPolicy it's in.",
      "app=biling-api": "That's the typo! Submit the name of the NetworkPolicy it's in.",
      "billing-api": "That's the workload left exposed. Submit the name of the NetworkPolicy that should have protected it.",
    },
    flag: "EDERA{K05_NETWORK_SEGMENTATION}",
    reward: ["billing-api-ingress selected app=biling-api, which matches no pods.", "With nothing selected, billing-api accepted traffic from every namespace.", "A selector typo fails silently: pair a default-deny with allow rules, and test the flows."],
  },
  {
    title: "K06 · Overly-exposed components",
    objective: "The API server tells anyone who asks, no credentials needed. What exact version does it leak?",
    brief: ["Read up on the Kubernetes API: https://kubernetes.io/docs/concepts/overview/kubernetes-api/", "Submit the exact version string."],
    answers: ["v1.30.2", "1.30.2"],
    nudges: {
      "v1.34.1": "That's your kubectl client's version. What does the API server report?",
      "1.34.1": "That's your kubectl client's version. What does the API server report?",
      "1.30": "Close. Which exact patch release?",
      "v1.30": "Close. Which exact patch release?",
    },
    flag: "EDERA{K06_EXPOSED_COMPONENT}",
    reward: ["/version answered an anonymous request with the exact build: v1.30.2.", "That release is out of support, so an attacker can match it against known CVEs.", "Keep the API server off untrusted networks, and treat version data as reconnaissance."],
  },
  {
    title: "K07 · Misconfigured components",
    objective: "An end-of-life PHP image with known CVEs is sitting in the node's Edera image cache. Find it and remove it.",
    brief: ["Read up on managing images with the protect CLI: https://docs.edera.dev/guides/cli-user-guide/#removing-images", "The flag is captured automatically once the image is removed."],
    answers: ["sha256:a766a07ccdc7b9dae4f45d0f811a7dfbd5845fe610514b313b3aba831fc7b44b"],
    flag: "EDERA{K07_VULNERABLE_COMPONENT}",
    reward: ["PHP 7.4 has had no security fixes since November 2022, so later CVEs stay unpatched.", "A zone limits the blast radius of a vulnerable app, but it doesn't patch PHP.", "Prune images you don't run, and keep base images on supported releases."],
  },
  {
    title: "K08 · Cluster-to-cloud lateral movement",
    objective: "Find the ServiceAccount annotated to request permissions from an AWS IAM role.",
    brief: ["Read up on cluster-to-cloud lateral movement: https://kubernetes-top10.owasp.org/2025/en/src/K08-Cluster-To-Cloud-Lateral-Movement.html", "Submit the ServiceAccount name."],
    answers: ["analytics-batch", "customer-d/analytics-batch", "system:serviceaccount:customer-d:analytics-batch"],
    nudges: {
      "analytics-batch-d": "That's the pod. Submit the ServiceAccount it runs as.",
      "analyticsexportrole": "That's the IAM role. Which ServiceAccount requests it?",
      "arn:aws:iam::123456789012:role/analyticsexportrole": "That's the IAM role. Which ServiceAccount requests it?",
    },
    flag: "EDERA{K08_CLOUD_LATERAL_MOVEMENT}",
    reward: ["analytics-batch can trade its projected token for AnalyticsExportRole's AWS credentials.", "Compromise that pod and an attacker is in the cloud account, not just the cluster.", "Scope IAM roles per workload, avoid static keys, and block pod access to instance metadata."],
  },
  {
    title: "K09 · Broken authentication mechanisms",
    objective: "Someone with no credentials at all can read more of this cluster than they should. Find the binding responsible.",
    brief: ["Read up on broken authentication mechanisms: https://kubernetes-top10.owasp.org/2025/en/src/K09-Broken-Authentication-Mechanisms.html", "Submit the binding name."],
    answers: ["cluster-status-public", "clusterrolebinding/cluster-status-public"],
    nudges: {
      "system:unauthenticated": "That's the group being granted access. Which binding grants it?",
      "system:anonymous": "That's the identity anonymous requests get. Which binding gives it access?",
      "cluster-status-reader": "That's the role. Which binding hands it to anonymous users?",
      "--anonymous-auth=false": "That's the fix. Which binding is the problem?",
      "anonymous-auth=false": "That's the fix. Which binding is the problem?",
    },
    flag: "EDERA{K09_BROKEN_AUTHENTICATION}",
    reward: ["cluster-status-public bound cluster-status-reader to system:unauthenticated.", "Anyone who could reach the API server could list every pod, node and namespace, with no credentials.", "Never grant RBAC to system:unauthenticated, and set --anonymous-auth=false where you can (test it first)."],
  },
  {
    title: "K10 · Inadequate logging and monitoring",
    objective: "Something suspicious ran on this node, and the alert never reached anyone. What process was it?",
    brief: ["Read up on inadequate logging and monitoring: https://kubernetes-top10.owasp.org/2025/en/src/K10-Inadequate-Logging-And-Monitoring.html", "Submit the process name."],
    answers: ["kworkerd", "/tmp/.cache/kworkerd"],
    nudges: {
      "recommendation-c": "That's where it ran. What process did the monitor see?",
      "edera-ebpf-test": "That's the monitor. What did it detect?",
      "su": "That's how it got root. What did it run?",
      "/usr/bin/su": "That's how it got root. What did it run?",
    },
    flag: "EDERA{K10_INSUFFICIENT_MONITORING}",
    reward: ["The monitor caught /tmp/.cache/kworkerd running as root in recommendation-c.", "Its alert webhook returned 404, the alert was dropped, and nobody was told.", "Detection without delivery is no detection: alert on failed alerts, and test the path end to end."],
  }
];

interface GameState {
  stage: number;
  captured: string[];
  commandCount: number;
  /* Pods the player has read in detail, used to reveal the diagram. */
  inspected: Set<string>;
  escalationDescribed: Set<string>;
  /* Secrets the player has listed or described ("namespace/name"). */
  secretsSeen: Set<string>;
  /* Whether the player has come across the blocked customer-e tenant. */
  blockedTenantSeen: boolean;
  zonesListed: boolean;
  cwd: string;
  namespace: string;
}

const state: GameState = {
  stage: 0,
  captured: [],
  commandCount: 0,
  inspected: new Set<string>(),
  escalationDescribed: new Set<string>(),
  secretsSeen: new Set<string>(),
  blockedTenantSeen: false,
  zonesListed: false,
  cwd: "/home/ivy",
  namespace: "default",
};

/* Shell history, oldest first. Recalled with the up and down arrows. */
const commandHistory: string[] = [];

interface TerminalEntry {
  type: "command" | "output" | "html";
  text: string;
  /*
   * Command entries capture the prompt at submission time. Otherwise
   * re-rendering the terminal after `cd` would make older commands appear
   * to have been entered from the new working directory.
   */
  prompt?: string;
}

const terminalHistory: TerminalEntry[] = [];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Application root not found.");
}


/** Per-workload hardening profiles used by the simulated manifests. */
function securityProfileFor(pod: Pick<Pod, "name" | "allowPrivilegeEscalation">) {
  const profiles: Record<string, {
    runAsNonRoot: boolean;
    runAsUser: number;
    readOnlyRootFilesystem: boolean;
    dropCapabilities: boolean;
    seccompProfile: "RuntimeDefault" | "Localhost";
    automountServiceAccountToken: boolean;
  }> = {
    "image-processor-a": { runAsNonRoot: true, runAsUser: 10001, readOnlyRootFilesystem: true, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
    "billing-api-b": { runAsNonRoot: true, runAsUser: 10002, readOnlyRootFilesystem: true, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
    "edera-ebpf-test": { runAsNonRoot: true, runAsUser: 10003, readOnlyRootFilesystem: false, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
    "analytics-batch-d": { runAsNonRoot: true, runAsUser: 10004, readOnlyRootFilesystem: true, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
    "recommendation-c": { runAsNonRoot: true, runAsUser: 10005, readOnlyRootFilesystem: true, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
    "gpu-workload": { runAsNonRoot: true, runAsUser: 10006, readOnlyRootFilesystem: false, dropCapabilities: true, seccompProfile: "RuntimeDefault", automountServiceAccountToken: false },
  };
  return {
    allowPrivilegeEscalation: pod.allowPrivilegeEscalation ?? false,
    ...(profiles[pod.name] ?? { runAsNonRoot: true, runAsUser: 1000, readOnlyRootFilesystem: true, dropCapabilities: true, seccompProfile: "RuntimeDefault" as const, automountServiceAccountToken: false }),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function terminalText(value: string): string {
  return escapeHtml(value).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a class="terminal-link" href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}

function terminalKubectlText(value: string): string {
  let output = escapeHtml(value);

  /*
   * Keep kubectl's output as text and add presentation-only markup:
   * - A missing RuntimeClass is a high-signal finding in this lab, so the
   *   complete `runtimeClassName:  <none>` line is bold red.
   * - Common pod lifecycle states get kubecolor-style emphasis.
   *
   * The status matches require whitespace around the value so that an
   * unrelated word containing "Running" or "ContainerCreating" is not
   * accidentally styled.
   */
  output = output.replace(
    /(^|[ \t])(Running)(?=[ \t]|$)/gm,
    '$1<span class="terminal-status-running">$2</span>',
  );

  output = output.replace(
    /(^|[ \t])(ContainerCreating)(?=[ \t]|$)/gm,
    '$1<span class="terminal-status-creating">$2</span>',
  );

  output = output.replace(
    /(^|[ \t])(ready)(?=[ \t]|$)/gm,
    '$1<span class="terminal-zone-ready">$2</span>',
  );

  output = output.replace(
    /(^|[ \t])(failed)(?=[ \t]|$)/gm,
    '$1<span class="terminal-zone-failed">$2</span>',
  );

  output = output.replace(
    /(^|\n)(runtimeClassName:\s+&lt;none&gt;)(?=\n|$)/g,
    '$1<span class="terminal-runtime-missing">$2</span>',
  );

  return output.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a class="terminal-link" href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}

interface HelpCommand {
  command: string;
  description: string;
}

interface HelpSection {
  title: string;
  commands: HelpCommand[];
}

const helpSections: HelpSection[] = [
  {
    title: "Kubernetes",
    commands: [
      {
        command: "kubectl get pods [-A] [-o wide] [--show-labels] [-l app=<name>]",
        description: "List pods, optionally across namespaces or with labels.",
      },
      {
        command: "kubectl get pod <name> -n <namespace> -o yaml",
        description: "Read the complete manifest for a pod.",
      },
      {
        command: "kubectl describe pod <name> -n <namespace>",
        description: "Inspect detailed pod state and runtime information.",
      },
      {
        command: "kubectl describe pods [-A]",
        description: "Describe every pod in the current namespace, or across all namespaces.",
      },
      {
        command: "kubectl get namespaces [--show-labels]",
        description: "List the namespaces in the cluster, optionally with labels.",
      },
      {
        command: "kubectl label namespace <name> <key>=<value>",
        description: "Add or change a label on a namespace.",
      },
      {
        command: "kubectl get clusterpolicies [-o yaml]",
        description: "List Kyverno ClusterPolicies, or read their rules.",
      },
      {
        command: "kubectl get deployments [-A]",
        description: "List Deployments and how many replicas are ready.",
      },
      {
        command: "kubectl get events [-n <namespace>] [-A]",
        description: "Show recent cluster events, such as failed Pod creation.",
      },
      {
        command: "kubectl get networkpolicies [-A] [-o yaml]",
        description: "List NetworkPolicies and the pods they select.",
      },
      {
        command: "kubectl get nodes [-o wide] [--show-labels]",
        description:
          "List nodes, optionally with IP and system information.",
      },
      {
        command: "kubectl describe node worker-02",
        description:
          "Inspect the worker node, IP, labels, and runtime details.",
      },
      {
        command: "kubectl get runtimeclass",
        description: "List the RuntimeClass objects configured in the cluster.",
      },
      {
        command: "kubectl get serviceaccounts [-A]",
        description: "List service accounts, the identities workloads run as.",
      },
      {
        command: "kubectl get secrets [-A] [-o yaml]",
        description: "List Secrets, or dump their (base64-encoded) contents.",
      },
      {
        command: "kubectl get clusterrolebindings [-o wide]",
        description: "List cluster-wide role grants and who they apply to.",
      },
      {
        command: "kubectl get rolebindings [-A] [-o wide]",
        description: "List namespace-scoped role grants.",
      },
      {
        command: "kubectl describe clusterrole|role <name>",
        description: "Show the permissions a role grants.",
      },
      {
        command: "kubectl auth can-i --list --as=<user>",
        description: "List what a user or service account is allowed to do.",
      },
      {
        command: "kubectl apply -f <file|directory>",
        description: "Create or update pods from manifests on the node.",
      },
      {
        command: "kubectl delete -f <file|directory>",
        description: "Delete pods described by manifests on the node.",
      },
      {
        command: "kubectl exec <name> -n <namespace> -- <command>",
        description: "Execute a command inside a pod.",
      },
      {
        command: "kubectl logs <name> -n <namespace> [--tail=<n>]",
        description: "Print a pod's container logs (stdout and stderr).",
      },
      {
        command: "kubectl cluster-info",
        description: "Show where the Kubernetes control plane is running.",
      },
    ],
  },
  {
    title: "Edera",
    commands: [
      {
        command: "protect host status",
        description: "Show daemon, node, kernel, zone, and workload status.",
      },
      {
        command: "protect zone list [--selector status.state=failed]",
        description: "List Edera zones, optionally filtered by state.",
      },
      {
        command: "protect zone list <name> --output json-pretty",
        description: "Inspect a zone as formatted JSON.",
      },
      {
        command: "protect zone launch --name <name> [--wait]",
        description: "Create a ready Edera zone for a workload.",
      },
      {
        command: "protect zone logs <name> [--follow]",
        description: "Read zone logs, optionally following the live stream.",
      },
      {
        command: "protect image list [--output table]",
        description: "List available Edera images.",
      },
      {
        command: "protect image remove <digest>",
        description: "Remove an image from the node's Edera image cache.",
      },
      {
        command: "protect image pull <reference>",
        description: "Pull an image into the Edera image cache.",
      },
      {
        command: "protect image list-kernel-variants",
        description: "List the kernel variants available to Edera zones.",
      },
      {
        command: "protect workload list [--selector status.state=running]",
        description: "List workloads, optionally filtered by state.",
      },
      {
        command: "protect workload launch --zone <zone> --name <name> <image>",
        description: "Launch an image into an Edera zone.",
      },
      {
        command: "protect workload exec <name> <command>",
        description: "Execute a command through the Edera workload interface.",
      },
    ],
  },
  {
    title: "Shell",
    commands: [
      { command: "pwd", description: "Print the current working directory." },
      { command: "cd <directory>", description: "Change the current working directory." },
      { command: "ls [-la]", description: "List files and directories." },
      { command: "cat <file>", description: "Read a file from the node filesystem." },
      { command: "tree", description: "Display the node filesystem tree." },
      { command: "echo <value> | base64 -d", description: "Decode a base64 value, such as Secret data." },
      { command: "whoami", description: "Print the current user." },
      { command: "hostname", description: "Print the node hostname." },
      { command: "uname -a", description: "Display kernel and system information." },
      { command: "env", description: "Display the simulated node environment." },
      { command: "ps", description: "List simulated running processes." },
      { command: "curl [-sk] <url>", description: "Make an HTTP request from the node." },
      {
        command: "history",
        description: "Recall previously entered commands, or use ↑ / ↓.",
      },
      { command: "clear", description: "Clear the terminal history." },
    ],
  },
  {
    title: "Lab",
    commands: [
      { command: "objective", description: "Show the current investigation objective." },
      { command: "flags", description: "Show flags captured so far." },
      { command: "submit <value>", description: "Submit a value for the current objective." },
    ],
  },
];

function renderCliHelp(): string {
  return `
    <div class="cli-help">
      <div class="cli-help-intro">
        <strong>COMMAND REFERENCE</strong>
        <span>Use these commands to explore the lab.</span>
      </div>

      ${helpSections
        .map(
          (section) => `
            <section class="cli-help-section">
              <div class="cli-help-section-title">${escapeHtml(section.title)}</div>
              ${section.commands
                .map(
                  (item) => `
                    <div class="cli-help-command">
                      <code>${escapeHtml(item.command)}</code>
                      <span>${escapeHtml(item.description)}</span>
                    </div>
                  `,
                )
                .join("")}
            </section>
          `,
        )
        .join("")}

      <div class="cli-help-tip">
        <strong>Tip</strong>
        Start with <code>objective</code>, then investigate the node with the commands above.
      </div>
    </div>
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prompt(): string {
  const home = "/home/ivy";
  const path =
    state.cwd === home
      ? "~"
      : state.cwd.startsWith(`${home}/`)
        ? `~${state.cwd.slice(home.length)}`
        : state.cwd;

  return `ivy@worker-02:${path}$`;
}

function complete(): boolean {
  return state.stage >= stages.length;
}

function currentStage(): Stage | null {
  return complete() ? null : stages[state.stage];
}

/*
 * Column-padded output, matching the table format both kubectl and
 * `protect --output table` produce.
 */
function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );

  const line = (cells: string[]): string =>
    cells
      .map((cell, index) =>
        index === cells.length - 1 ? cell : cell.padEnd(widths[index] + 3),
      )
      .join("")
      .trimEnd();

  return [line(headers), ...rows.map(line)].join("\n");
}

function findPod(name: string): Pod | undefined {
  return pods.find((pod) => pod.name === name);
}

function findZone(name: string): Zone | undefined {
  return zones.find((zone) => zone.name === name);
}

function notFound(kind: string, name: string): string {
  return `Error from server (NotFound): ${kind} "${name}" not found`;
}

/* -------------------------------------------------------------------------- */
/* Node filesystem                                                            */
/*                                                                            */
/* This is worker-02 itself, not a container: the daemon socket, the Edera     */
/* config the daemon reads, and the manifests this node's workloads were       */
/* applied from.                                                               */
/* -------------------------------------------------------------------------- */

const directories = new Set<string>([
  "/",
  "/etc",
  "/etc/edera",
  "/etc/kubernetes",
  "/home",
  "/home/ivy",
  "/home/ivy/manifests",
  "/home/ivy/.kube",
  "/proc",
  "/var",
  "/var/lib",
  "/var/lib/edera",
  "/var/lib/edera/protect",
  "/var/lib/edera/protect/images",
  "/var/lib/kubelet",
]);

function manifestFor(pod: Pod): string {
  return [
    "apiVersion: v1",
    "kind: Pod",
    "metadata:",
    `  name: ${pod.name}`,
    `  namespace: ${pod.namespace}`,
    "  annotations:",
    ...Object.entries(pod.annotations).map(
      ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
    ),
    "spec:",
    ...(pod.runtimeClass ? [`  runtimeClassName: ${pod.runtimeClass}`] : []),
    `  automountServiceAccountToken: ${securityProfileFor(pod).automountServiceAccountToken}`,
    "  containers:",
    `  - name: ${pod.app}`,
    `    image: ${pod.image}`,
    "    securityContext:",
    `      privileged: ${pod.privileged}`,
    ...Object.entries(securityProfileFor(pod)).filter(([key]) => key !== "automountServiceAccountToken").map(([key, value]) =>
      key === "dropCapabilities"
        ? `      capabilities:\n        drop:\n          - ALL`
        : key === "seccompProfile"
          ? `      seccompProfile:\n        type: ${value}`
          : `      ${key}: ${value}`,
    ),
  ].join("\n");
}

const virtualFiles: Record<string, string> = {
  "/etc/hostname": NODE.name,

  "/etc/os-release": [
    'NAME="Ubuntu 20.04 LTS"',
    'VERSION="1.4"',
    "ID=edera",
    "VARIANT=worker",
  ].join("\n"),

  "/proc/version": `Linux version ${NODE.kernelVersion} (build@${NODE.name})`,

  "/etc/edera/daemon.toml": [
    "[daemon]",
    'listen = "unix:///var/lib/edera/protect/daemon.socket"',
    "",
    "[zone]",
    `default-kernel = "${ZONE_KERNEL}"`,
    "",
    "[zone.kernel-variants]",
    ...kernelVariants.map(
      (variant) => `${variant.name} = "${variant.image}"`,
    ),
  ].join("\n"),

  "/etc/edera/cri.toml": [
    "[runtime]",
    'handler = "edera"',
    "",
    "# Pods are routed to a zone only when their spec sets",
    "# runtimeClassName: edera. Anything else falls through to",
    "# the default runtime and shares this node's kernel.",
    'fallback = "runc"',
  ].join("\n"),

  "/var/lib/edera/protect/daemon.socket": "",

  "/var/lib/kubelet/config.yaml": [
    "apiVersion: kubelet.config.k8s.io/v1beta1",
    "kind: KubeletConfiguration",
    "authentication:",
    "  anonymous:",
    "    enabled: false",
    "  webhook:",
    "    enabled: true",
    "  x509:",
    "    clientCAFile: /etc/kubernetes/pki/ca.crt",
    "authorization:",
    "  mode: Webhook",
    "readOnlyPort: 0",
    "cgroupDriver: systemd",
    "containerRuntimeEndpoint: unix:///run/containerd/containerd.sock",
  ].join("\n"),

  "/home/ivy/.kube/config": [
    "apiVersion: v1",
    "kind: Config",
    "clusters:",
    "- cluster:",
    "    certificate-authority-data: bGFiLW9ubHktbm90LWEtcmVhbC1jYQo=",
    "    server: https://10.10.0.10:6443",
    "  name: edera-lab",
    "contexts:",
    "- context:",
    "    cluster: edera-lab",
    "    user: ivy",
    "  name: ivy@edera-lab",
    "current-context: ivy@edera-lab",
    "users:",
    "- name: ivy",
    "  user:",
    "    client-certificate-data: bGFiLW9ubHktbm90LWEtcmVhbC1jZXJ0Cg==",
    "    client-key-data: bGFiLW9ubHktbm90LWEtcmVhbC1rZXkK",
  ].join("\n"),

  "/home/ivy/.profile": [
    "# ivy engineer, worker-02",
    "export KUBECONFIG=/home/ivy/.kube/config",
    "export EDERA_SOCKET=/var/lib/edera/protect/daemon.socket",
  ].join("\n"),

  "/home/ivy/README": [
    "Node audit notes",
    "----------------",
    "Manifests for everything scheduled here are in ./manifests.",
    "OWASP Top 10:2025 evidence notes are in ./evidence.",
    "",
    "kubectl and protect are both on PATH. The daemon socket is",
    "readable by this account, so protect talks to it directly.",
  ].join("\n"),
};



/* OWASP Top 10:2025 scenario manifests and evidence notes (synthetic lab data). */
const OWASP_SCENARIO_FILES: Record<string, string> = {
  "/home/ivy/manifests/rbac-audit.yaml": "apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRoleBinding\nmetadata:\n  name: report-bot-admin\nsubjects:\n  - kind: ServiceAccount\n    name: report-bot\n    namespace: customer-b\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ClusterRole\n  name: cluster-admin\n",
  "/home/ivy/manifests/billing-api.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: billing-api-audit\n  namespace: customer-b\nspec:\n  containers:\n    - name: billing-api\n      image: ghcr.io/acme/billing-api:3.0.1\n      env:\n        - name: BILLING_TOKEN\n          valueFrom:\n            secretKeyRef:\n              name: billing-api-token\n              key: token\n",
  "/home/ivy/manifests/policy-audit.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: admission-policy-audit\n  namespace: kube-system\ndata:\n  expected-policy: restricted-workloads\n  status: missing\n",
  "/home/ivy/manifests/network-audit.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: network-policy-audit\n  namespace: customer-b\ndata:\n  namespace: customer-b\n  finding: no-default-deny-ingress\n",
  "/home/ivy/manifests/component-exposure.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: metrics-dashboard\n  namespace: platform\nspec:\n  type: LoadBalancer\n  ports:\n    - port: 9090\n      targetPort: 9090\n",
  "/home/ivy/manifests/vulnerable-component.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: legacy-metrics\n  namespace: platform\nspec:\n  containers:\n    - name: metrics\n      image: example.invalid/legacy-metrics:latest\n",
  "/home/ivy/manifests/cloud-identity.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: invoice-exporter\n  namespace: customer-b\nspec:\n  containers:\n    - name: exporter\n      image: ghcr.io/acme/invoice-exporter:1.0.0\n      env:\n        - name: CLOUD_METADATA_ACCESS\n          value: \"enabled\"\n",
  "/home/ivy/manifests/authentication-audit.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: legacy-auth-proxy\n  namespace: platform\ndata:\n  allowUnauthenticatedHealthAndAdmin: \"true\"\n",
  "/home/ivy/manifests/audit-policy.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: audit-policy\n  namespace: kube-system\ndata:\n  omitted-resources: \"secrets\"\n  omitted-levels: \"RequestResponse\"\n",
  "/home/ivy/evidence/rbac-review.txt": "RBAC review \u2014 customer-b\nFinding: RoleBinding report-bot-admin binds ServiceAccount report-bot to ClusterRole cluster-admin.\nExpected answer: report-bot\nRemediation: replace with a namespace-scoped Role containing only required verbs and resources.\n",
  "/home/ivy/evidence/secret-review.txt": "Secret review \u2014 billing-api\nFinding: the workload manifest references BILLING_TOKEN from Secret billing-api-token; lab evidence confirms it was copied into an environment dump.\nExpected answer: billing-api-token\nRemediation: rotate the lab credential and restrict Secret read access.\n",
  "/home/ivy/evidence/policy-review.txt": "Admission policy review\nFinding: the Restricted Pod Security baseline is documented but no enforcing admission policy named restricted-workloads is active.\nExpected answer: restricted-workloads\n",
  "/home/ivy/evidence/network-review.txt": "Network review\nFinding: namespace customer-b has no default-deny ingress policy and billing-api accepts connections from every namespace.\nExpected answer: customer-b\n",
  "/home/ivy/evidence/component-review.txt": "Exposure review\nFinding: metrics-dashboard is exposed through a public LoadBalancer service without an authentication gateway.\nExpected answer: metrics-dashboard\n",
  "/home/ivy/evidence/cloud-review.txt": "Cloud identity review\nFinding: invoice-exporter can reach the simulated cloud metadata endpoint and is assigned a broad export role.\nExpected answer: invoice-exporter\nAll cloud endpoints in this lab are simulated; no real cloud credentials exist.\n",
  "/home/ivy/evidence/auth-review.txt": "Authentication review\nFinding: legacy-auth-proxy enables allowUnauthenticatedHealthAndAdmin=true; the simulated admin route shares this bypass.\nExpected answer: legacy-auth-proxy\nRemediation: remove the bypass and validate issuer, audience, expiry, and signature.\n",
  "/home/ivy/evidence/audit-review.txt": "Audit review\nFinding: the policy omits secrets metadata and response-level events, leaving Secret reads difficult to investigate.\nExpected answer: secrets-metadata-and-response\n",
};
Object.assign(virtualFiles, OWASP_SCENARIO_FILES);
for (const path of Object.keys(OWASP_SCENARIO_FILES)) directories.add(path.slice(0, path.lastIndexOf("/")));

/* Each workload's manifest, as applied. */
for (const pod of pods) {
  virtualFiles[`/home/ivy/manifests/${pod.name}.yaml`] = manifestFor(pod);
  directories.add("/home/ivy/manifests");
}

/*
 * Hand-written manifests are stored verbatim, then applied through the same
 * path as `kubectl apply -f` so the lab starts with them already running.
 */
virtualFiles[GPU_WORKLOAD_MANIFEST_PATH] = GPU_WORKLOAD_MANIFEST;

const bootApplyResult = applyManifest(GPU_WORKLOAD_MANIFEST_PATH);

if (!bootApplyResult.startsWith("pod/")) {
  console.error(`Boot-time apply failed: ${bootApplyResult}`);
}

function resolvePath(input: string): string {
  const base = input.startsWith("/")
    ? []
    : state.cwd.split("/").filter(Boolean);

  const expanded = input.startsWith("~")
    ? `/home/ivy${input.slice(1)}`
    : input;

  const segments = expanded.startsWith("/")
    ? expanded.split("/").filter(Boolean)
    : [...base, ...expanded.split("/").filter(Boolean)];

  const stack: string[] = [];

  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }

  return `/${stack.join("/")}`;
}

function childrenOf(path: string): string[] {
  const prefix = path === "/" ? "/" : `${path}/`;
  const seen = new Set<string>();

  for (const candidate of [...directories, ...Object.keys(virtualFiles)]) {
    if (candidate === path || !candidate.startsWith(prefix)) continue;

    const rest = candidate.slice(prefix.length);

    if (rest) seen.add(rest.split("/")[0]);
  }

  return [...seen].sort();
}

function listDirectory(input: string, long: boolean, showHidden: boolean): string {
  const path = resolvePath(input || state.cwd);

  if (path in virtualFiles) return input || path;

  if (!directories.has(path)) {
    return `ls: cannot access '${input || path}': No such file or directory`;
  }

  const entries = childrenOf(path).filter(
    (entry) => showHidden || !entry.startsWith("."),
  );

  if (entries.length === 0) return "";

  if (!long) return entries.join("  ");

  return [
    `total ${entries.length * 4}`,
    ...entries.map((entry) => {
      const full = path === "/" ? `/${entry}` : `${path}/${entry}`;
      const isDir = directories.has(full);
      const size = isDir ? 4096 : (virtualFiles[full]?.length ?? 0);

      return `${isDir ? "drwxr-xr-x" : "-rw-r--r--"}  1 ivy ivy ${String(
        size,
      ).padStart(6)} ${entry}`;
    }),
  ].join("\n");
}

function treeFrom(path: string, prefix = ""): string[] {
  const entries = childrenOf(path);

  return entries.flatMap((entry, index) => {
    const last = index === entries.length - 1;
    const full = path === "/" ? `/${entry}` : `${path}/${entry}`;
    const line = `${prefix}${last ? "└── " : "├── "}${entry}`;

    return directories.has(full)
      ? [line, ...treeFrom(full, `${prefix}${last ? "    " : "│   "}`)]
      : [line];
  });
}

function changeDirectory(input: string | undefined): string {
  const path = resolvePath(input ?? "/home/ivy");

  if (directories.has(path)) {
    state.cwd = path;
    return "";
  }

  if (path in virtualFiles) return `cd: not a directory: ${input}`;

  return `cd: no such file or directory: ${input}`;
}

function readFile(input: string | undefined): string {
  if (!input) return "usage: cat <file>";

  const path = resolvePath(input);

  if (path in virtualFiles) {
    return virtualFiles[path] || `cat: ${input}: is a socket`;
  }

  if (directories.has(path)) return `cat: ${input}: Is a directory`;

  return `cat: ${input}: No such file or directory`;
}

/* -------------------------------------------------------------------------- */
/* kubectl                                                                    */
/* -------------------------------------------------------------------------- */

interface KubectlFlags {
  namespace: string;
  allNamespaces: boolean;
  showLabels: boolean;
  wide: boolean;
  yaml: boolean;
  selector: string | null;
}

function parseFlags(tokens: string[]): KubectlFlags {
  const flags: KubectlFlags = {
    namespace: state.namespace,
    allNamespaces: false,
    showLabels: false,
    wide: false,
    yaml: false,
    selector: null,
  };

  tokens.forEach((token, index) => {
    const next = tokens[index + 1];

    if (token === "-A" || token === "--all-namespaces") flags.allNamespaces = true;
    if (token === "--show-labels") flags.showLabels = true;

    if (token === "-n" || token === "--namespace") {
      if (next) flags.namespace = next;
    }

    if (token.startsWith("--namespace=")) flags.namespace = token.slice(12);

    if (token === "-o" || token === "--output") {
      if (next === "wide") flags.wide = true;
      if (next === "yaml") flags.yaml = true;
    }

    if (token.startsWith("-o=")) {
      if (token.slice(3) === "wide") flags.wide = true;
      if (token.slice(3) === "yaml") flags.yaml = true;
    }

    if (token === "-l" || token === "--selector") {
      if (next) flags.selector = next;
    }

    if (token.startsWith("-l=")) flags.selector = token.slice(3);
  });

  return flags;
}

/*
 * Every workload is labelled as Edera-managed. A label is a claim the author
 * wrote down, not something the ivy enforces — one of these pods does
 * not back it up in its spec.
 */
function labelsFor(pod: Pod): Record<string, string> {
  return {
    app: pod.app,
    team: pod.namespace,
    runtime: "edera",
  };
}

function labelString(pod: Pod): string {
  return Object.entries(labelsFor(pod))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function matchesSelector(pod: Pod, selector: string | null): boolean {
  if (!selector) return true;

  const labels = labelsFor(pod);

  return selector.split(",").every((clause) => {
    const [key, value] = clause.split("=");

    return labels[key.trim()] === value?.trim();
  });
}

function scopedPods(flags: KubectlFlags): Pod[] {
  return pods
    .filter((pod) => flags.allNamespaces || pod.namespace === flags.namespace)
    .filter((pod) => matchesSelector(pod, flags.selector));
}

function kubectlUsage(): string {
  return [
    "usage: kubectl <verb> <resource> [name] [flags]",
    "",
    "  kubectl get pods [-A] [-o wide] [--show-labels] [-l app=<name>]",
    "  kubectl get pod <name> -n <namespace> -o yaml",
    "  kubectl describe pod <name> -n <namespace>",
    "  kubectl describe pods [-A] [-l app=<name>]",
    "  kubectl get nodes [-o wide] [--show-labels]",
    "  kubectl describe node worker-02",
    "  kubectl get namespaces [--show-labels]",
    "  kubectl label namespace <name> <key>=<value> [--overwrite]",
    "  kubectl get clusterpolicies [-o yaml]",
    "  kubectl get deployments|events [-n <namespace>] [-A]",
    "  kubectl get networkpolicies [-A] [-o yaml]",
    "  kubectl get runtimeclass",
    "  kubectl get serviceaccounts|secrets [-A] [-o yaml]",
    "  kubectl get clusterroles|clusterrolebindings [-o wide|yaml]",
    "  kubectl get roles|rolebindings [-A] [-o wide|yaml]",
    "  kubectl describe <resource> [name] [-n <namespace>]",
    "  kubectl auth can-i <verb> <resource> [--as=<user>]",
    "  kubectl auth can-i --list [--as=<user>]",
    "  kubectl apply -f <file|directory>",
    "  kubectl delete pod <name> -n <namespace>",
    "  kubectl delete -f <file|directory>",
    "  kubectl exec <name> -n <namespace> -- <command>",
    "  kubectl logs <name> -n <namespace> [--tail=<n>]",
    "  kubectl version",
    "  kubectl cluster-info",
    "  kubectl get --raw <path>",
  ].join("\n");
}

function getPods(flags: KubectlFlags): string {
  const visible = scopedPods(flags);

  if (visible.length === 0) {
    return flags.allNamespaces
      ? "No resources found."
      : `No resources found in ${flags.namespace} namespace.`;
  }

  const headers = ["NAME", "READY", "STATUS", "RESTARTS", "AGE"];
  if (flags.allNamespaces) headers.unshift("NAMESPACE");
  if (flags.wide) headers.push("IP", "NODE");
  if (flags.showLabels) headers.push("LABELS");

  const rows = visible.map((pod) => {
    const row = [
      pod.name,
      pod.status === "Running" ? "1/1" : "0/1",
      pod.status,
      "0",
      pod.name === PAYMENTS.pod ? "12s" : "3h12m",
    ];

    if (flags.allNamespaces) row.unshift(pod.namespace);
    if (flags.wide) {
      row.push(podIp(pod), pod.node);
    }
    if (flags.showLabels) row.push(labelString(pod));

    return row;
  });

  return table(headers, rows);
}

/* Stable per-pod IPs, so pod logs can reference them reliably. */
const POD_IPS: Record<string, string> = {
  "image-processor-a": "10.244.1.21",
  "billing-api-b": "10.244.1.22",
  "edera-ebpf-test": "10.244.1.23",
  "analytics-batch-d": "10.244.1.24",
  "recommendation-c": "10.244.1.25",
  "gpu-workload": "10.244.1.26",
  "payments-worker-6d8f7b9c4-x2k9q": "10.244.1.27",
};

function podIp(pod: Pod): string {
  return POD_IPS[pod.name] ?? `10.244.1.${40 + (pods.indexOf(pod) % 200)}`;
}

function resolvePod(name: string, flags: KubectlFlags): Pod | undefined {
  return pods.find(
    (pod) =>
      pod.name === name &&
      (flags.allNamespaces || pod.namespace === flags.namespace),
  );
}

function describePod(name: string | undefined, flags: KubectlFlags): string {
  // Like real kubectl, `describe pods` with no name describes every pod in
  // scope (current namespace, or all namespaces with -A), honouring -l.
  if (!name) {
    const visible = scopedPods(flags);
    if (visible.length === 0) {
      return flags.allNamespaces
        ? "No resources found."
        : `No resources found in ${flags.namespace} namespace.`;
    }
    return visible.map((pod) => describePodDetails(pod)).join("\n\n\n");
  }

  const pod = resolvePod(name, flags);

  if (!pod) return notFound("pods", name);

  return describePodDetails(pod);
}

function describePodDetails(pod: Pod): string {
  state.inspected.add(pod.name);
  if (securityProfileFor(pod).allowPrivilegeEscalation) {
    state.escalationDescribed.add(pod.name);
  }

  /* Real `kubectl describe pod` aligns its header to an 18-column label. */
  const field = (label: string, value: string) => `${`${label}:`.padEnd(18)}${value}`;
  const continuation = " ".repeat(18);

  const annotationLines = Object.entries(pod.annotations).map(
    ([key, value], index) =>
      index === 0 ? field("Annotations", `${key}: ${value}`) : `${continuation}${key}: ${value}`,
  );

  const labelLines = Object.entries(labelsFor(pod)).map(([key, value], index) =>
    index === 0 ? field("Labels", `${key}=${value}`) : `${continuation}${key}=${value}`,
  );

  return [
    field("Name", pod.name),
    field("Namespace", pod.namespace),
    field("Service Account", serviceAccountFor(pod)?.name ?? "default"),
    field("Node", pod.node),
    field("Status", pod.status),
    ...labelLines,
    ...annotationLines,
    field("runtimeClassName", pod.runtimeClass ?? "<none>"),
    "",
    "Containers:",
    `  ${pod.app}:`,
    `    Image:       ${pod.image}`,
    ...(Object.keys(awsIdentityEnv(pod)).length
      ? ["    Environment:", ...Object.entries(awsIdentityEnv(pod)).map(([key, value]) => `      ${key}:  ${value}`)]
      : ["    Environment: <none>"]),
    `    Privileged:  ${pod.privileged}`,
    `    AllowPrivilegeEscalation: ${securityProfileFor(pod).allowPrivilegeEscalation}`,
    `    RunAsNonRoot: ${securityProfileFor(pod).runAsNonRoot}`,
    `    ReadOnlyRootFilesystem: ${securityProfileFor(pod).readOnlyRootFilesystem}`,
    `    SeccompProfile: ${securityProfileFor(pod).seccompProfile}`,
    "",
    "Events:",
    pod.status === "Running"
      ? "  Normal  Started  container started"
      : "  Warning  FailedCreatePodSandbox  zone did not become ready",
  ].join("\n");
}

/* The ServiceAccount a pod runs as: one named after its app, else default. */
function serviceAccountFor(pod: Pod): ServiceAccountObject | undefined {
  return (
    serviceAccounts.find((account) => account.namespace === pod.namespace && account.name === pod.app) ??
    serviceAccounts.find((account) => account.namespace === pod.namespace && account.name === "default")
  );
}

/* What the AWS pod identity webhook injects for an IRSA-annotated account. */
function awsIdentityEnv(pod: Pod): Record<string, string> {
  const roleArn = serviceAccountFor(pod)?.annotations?.["eks.amazonaws.com/role-arn"];
  if (!roleArn) return {};
  return {
    AWS_ROLE_ARN: roleArn,
    AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/eks.amazonaws.com/serviceaccount/token",
    AWS_STS_REGIONAL_ENDPOINTS: "regional",
  };
}

function getPodYaml(name: string | undefined, flags: KubectlFlags): string {
  if (!name) return "error: resource name may not be empty";

  const pod = resolvePod(name, flags);

  if (!pod) return notFound("pods", name);

  state.inspected.add(pod.name);

  return [
    "apiVersion: v1",
    "kind: Pod",
    "metadata:",
    `  name: ${pod.name}`,
    `  namespace: ${pod.namespace}`,
    "  labels:",
    ...Object.entries(labelsFor(pod)).map(
      ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
    ),
    "  annotations:",
    ...Object.entries(pod.annotations).map(
      ([key, value]) => `    ${key}: ${JSON.stringify(value)}`,
    ),
    "spec:",
    ...(pod.runtimeClass ? [`  runtimeClassName: ${pod.runtimeClass}`] : []),
    `  serviceAccountName: ${serviceAccountFor(pod)?.name ?? "default"}`,
    `  automountServiceAccountToken: ${securityProfileFor(pod).automountServiceAccountToken}`,
    "  containers:",
    `  - name: ${pod.app}`,
    `    image: ${pod.image}`,
    ...(Object.keys(awsIdentityEnv(pod)).length
      ? [
          "    env:",
          ...Object.entries(awsIdentityEnv(pod)).flatMap(([key, value]) => [
            `    - name: ${key}`,
            `      value: ${value}`,
          ]),
        ]
      : []),
    "    securityContext:",
    `      privileged: ${pod.privileged}`,
    ...Object.entries(securityProfileFor(pod)).filter(([key]) => key !== "automountServiceAccountToken").map(([key, value]) =>
      key === "dropCapabilities"
        ? "      capabilities:\n        drop:\n          - ALL"
        : key === "seccompProfile"
          ? `      seccompProfile:\n        type: ${value}`
          : `      ${key}: ${value}`,
    ),
    "status:",
    `  phase: ${pod.status}`,
  ].join("\n");
}

/*
 * `kubectl get nodes -o wide` exposes the node's address and system details,
 * just like the real kubectl output.
 */
function getNodes(flags: KubectlFlags): string {
  const headers = ["NAME", "STATUS", "ROLES", "AGE", "VERSION"];

  if (flags.wide) {
    headers.push(
      "INTERNAL-IP",
      "OS-IMAGE",
      "KERNEL-VERSION",
      "CONTAINER-RUNTIME",
    );
  }

  if (flags.showLabels) {
    headers.push("LABELS");
  }

  const row = [
    NODE.name,
    NODE.status,
    "worker",
    "41d",
    "v1.31.4",
  ];

  if (flags.wide) {
    row.push(
      NODE.ip,
      NODE.os,
      NODE.kernelVersion,
      NODE.runtime,
    );
  }

  if (flags.showLabels) {
    row.push(
      Object.entries(NODE.labels)
        .map(([key, value]) => (value ? `${key}=${value}` : key))
        .join(","),
    );
  }

  return table(headers, [row]);
}

function describeNode(name: string | undefined): string {
  if (!name) return "error: resource name may not be empty";

  if (name !== NODE.name) return notFound("nodes", name);

  const scheduled = pods.filter((pod) => pod.node === NODE.name);

  const labelLines = Object.entries(NODE.labels).map(
    ([key, value], index) =>
      index === 0
        ? `Labels:              ${key}${value ? `=${value}` : ""}`
        : `                     ${key}${value ? `=${value}` : ""}`,
  );

  return [
    `Name:               ${NODE.name}`,
    "Roles:              worker",
    `InternalIP:         ${NODE.ip}`,
    `Status:             ${NODE.status}`,
    ...labelLines,
    "",
    "System Info:",
    `  Kernel Version:             ${NODE.kernelVersion}`,
    `  OS Image:                   ${NODE.os}`,
    `  Container Runtime Version:  ${NODE.runtime}`,
    "",
    "Capacity:",
    `  memory:  ${NODE.capacityMemory}`,
    "Allocatable:",
    `  memory:  ${NODE.allocatableMemory}`,
    "",
    "Non-terminated Pods:",
    table(
      ["NAMESPACE", "NAME", "MEMORY REQUESTS"],
      scheduled.map((pod) => [
        pod.namespace,
        pod.name,
        `${pod.annotations["dev.edera/initial-memory-request"] ?? "0"}Mi`,
      ]),
    )
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  ].join("\n");
}

function getRuntimeClass(): string {
  return [
    table(["NAME", "HANDLER", "AGE"], [["edera", "edera", "41d"]]),
    "",
    "The edera RuntimeClass is installed and available to every namespace.",
  ].join("\n");
}

function kubectlExec(
  name: string | undefined,
  rest: string,
  flags: KubectlFlags,
): string {
  if (!name) return "error: pod name may not be empty";

  const pod = resolvePod(name, flags);

  if (!pod) return notFound("pods", name);

  const command = rest.trim().split(/\s+/);
  if (command[0] === "curl") return curlCommand(command.slice(1), true);

  const wantsKernel = /proc\/version|uname/.test(rest);

  if (!wantsKernel) return `[${pod.name}] command executed`;

  if (pod.zone) {
    const zone = findZone(pod.zone);
    const version = zone?.kernel.split(":")[1] ?? "6.15";

    return `Linux version ${version}-edera-zone (zone@${pod.zone})`;
  }

  return [
    `Linux version ${NODE.kernelVersion} (build@${NODE.name})`,
    "",
    `That is the node's own kernel. ${pod.name} did not boot one.`,
    "It is sharing the host kernel, with privileged set to true.",
  ].join("\n");
}

interface ManifestAction {
  verb: "apply" | "delete";

  /*
   * Keep the original user-supplied filename in addition to the resolved
   * manifest paths. This lets the lab recognize deliberate attempts to
   * apply ~/.kube/config or the current working directory even though
   * neither is a Kubernetes manifest.
   */
  filename: string;
  paths: string[];
}

function yamlScalar(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed.replace(/^["']|["']$/g, "");
}

function parsePodManifest(content: string): Pod | undefined {
  /*
   * Metadata fields sit at a fixed two-space indent. Container fields accept
   * either common list style ("  - name:" or "    - name:"), and namespace
   * falls back to "default" like the real kubectl does.
   */
  const name = yamlScalar(/^[ \t]{2}name:[ \t]*(.+)$/m.exec(content)?.[1]);
  const namespace =
    yamlScalar(/^[ \t]{2}namespace:[ \t]*(.+)$/m.exec(content)?.[1]) ??
    "default";
  const containerName = yamlScalar(
    /^[ \t]*-[ \t]+name:[ \t]*(.+)$/m.exec(content)?.[1],
  );
  const image = yamlScalar(
    /^[ \t]+image:[ \t]*(.+)$/m.exec(content)?.[1],
  );

  if (!name || !containerName || !image) {
    return undefined;
  }

  const runtimeClassMatch =
    /^[ \t]+runtimeClassName:[ \t]*(.+)$/m.exec(content);
  const runtimeClass = yamlScalar(runtimeClassMatch?.[1]) ?? null;

  const privilegedMatch =
    /^[ \t]+privileged:[ \t]*(true|false)[ \t]*$/m.exec(content);
  const privileged = privilegedMatch?.[1] === "true";
  const escalationMatch = /^[ \t]+allowPrivilegeEscalation:[ \t]*(true|false)[ \t]*$/m.exec(content);
  const allowPrivilegeEscalation = escalationMatch
    ? escalationMatch[1] === "true"
    : (podTemplates.get(name)?.allowPrivilegeEscalation ?? false);

  const annotations: Record<string, string> = {};
  const annotationSection = content.match(
    /metadata:\s*\n(?:.*\n)*?\s{2}annotations:\s*\n([\s\S]*?)(?=\nspec:)/,
  );

  if (annotationSection) {
    for (const line of annotationSection[1].split("\n")) {
      const match = /^[ \t]{4,}([^:]+):[ \t]*(.+)$/.exec(line);

      if (!match) continue;

      const key = match[1].trim();
      const value = yamlScalar(match[2]);

      if (value !== undefined) annotations[key] = value;
    }
  }

  const template = podTemplates.get(name);

  const pod: Pod = {
    name,
    namespace,
    app: containerName,
    node: template?.node ?? NODE.name,
    status: template?.status ?? "Running",
    privileged,
    allowPrivilegeEscalation,
    runtimeClass,
    annotations,
    zone: template?.zone ?? null,
    image,
  };

  return pod;
}

function manifestPaths(input: string): string[] {
  const path = resolvePath(input);

  if (path in virtualFiles) return [path];

  if (!directories.has(path)) return [];

  return Object.keys(virtualFiles)
    .filter(
      (file) =>
        file.startsWith(`${path}/`) &&
        file.endsWith(".yaml") &&
        !file.slice(path.length + 1).includes("/"),
    )
    .sort();
}

function parseManifestAction(tokens: string[]): ManifestAction | undefined {
  const verb = tokens[0];

  if (verb !== "apply" && verb !== "delete") return undefined;

  let filename: string | undefined;

  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === "-f" || token === "--filename") {
      filename = tokens[index + 1];
      break;
    }

    if (token.startsWith("-f=")) {
      filename = token.slice(3);
      break;
    }

    if (token.startsWith("--filename=")) {
      filename = token.slice("--filename=".length);
      break;
    }
  }

  if (!filename) return undefined;

  return {
    verb,
    filename,
    paths: manifestPaths(filename),
  };
}

/*
 * Easter egg for attempts to apply the kubeconfig or the current working
 * directory.
 *
 * These are intentionally checked against the original argument rather than
 * the resolved manifest list. The kubeconfig doesn't exist as a readable
 * virtual file in the lab, and that's exactly why the special case needs to
 * happen before normal manifest resolution.
 */
const EDERA_ON_EASTER_EGG = [
  "Nice try. That's not a Kubernetes manifest.",
  "",
  "If you're looking for a less hands-on way to run Edera,",
  "you can sign up for a free trial of EderaOn:",
  "",
  "https://on.edera.dev",
].join("\n");

function isEderaOnEasterEgg(input: string): boolean {
  const trimmed = input.trim();

  /*
   * The shell doesn't currently perform environment-variable expansion, so
   * explicitly recognize the common ways a player might refer to $PWD.
   */
  const expanded =
    trimmed === "$PWD" || trimmed === "${PWD}"
      ? state.cwd
      : trimmed;

  const path = resolvePath(expanded);

  return (
    path === "/home/ivy/.kube/config" ||
    path === "/home/ivy" ||
    path === state.cwd
  );
}

function syncZoneForPod(pod: Pod): void {
  const zoneName = pod.zone;

  if (!zoneName || !pod.runtimeClass) {
    zones.splice(
      0,
      zones.length,
      ...zones.filter((zone) => zone.pod !== pod.name),
    );
    return;
  }

  const template = zoneTemplates.get(zoneName);

  if (!template) return;

  const nextZone: Zone = {
    ...template,
    pod: pod.name,
    failure: template.failure ? [...template.failure] : undefined,
  };

  const existingIndex = zones.findIndex((zone) => zone.name === zoneName);

  if (existingIndex === -1) {
    zones.push(nextZone);
  } else {
    zones[existingIndex] = nextZone;
  }
}

function applyManifest(path: string): string {
  const content = virtualFiles[path];

  if (content === undefined) {
    return `error: the path "${path}" does not exist`;
  }

  const pod = parsePodManifest(content);

  if (!pod) {
    return `error: unable to parse Pod manifest "${path}"`;
  }

  if (!isOnboarded(pod.namespace)) {
    return `Error from server: error when creating "${path}": ${kyvernoDenial(pod.namespace, pod.name)}`;
  }

  const existingIndex = pods.findIndex(
    (existing) => existing.name === pod.name,
  );

  if (existingIndex === -1) {
    pods.push(pod);
  } else {
    pods[existingIndex] = pod;
  }

  syncZoneForPod(pod);

  return `pod/${pod.name} configured`;
}

function removePod(pod: Pod): void {
  const existingIndex = pods.findIndex(
    (existing) => existing.name === pod.name,
  );

  if (existingIndex !== -1) {
    pods.splice(existingIndex, 1);
  }

  for (let index = zones.length - 1; index >= 0; index--) {
    if (zones[index].pod === pod.name) zones.splice(index, 1);
  }

  state.inspected.delete(pod.name);
  state.escalationDescribed.delete(pod.name);
}

function deletePod(name: string | undefined, flags: KubectlFlags): string {
  if (!name) return "error: resource name may not be empty";

  const pod = resolvePod(name, flags);

  if (!pod) return notFound("pods", name);

  removePod(pod);

  return `pod "${pod.name}" deleted`;
}

function deleteManifest(path: string): string {
  const content = virtualFiles[path];

  if (content === undefined) {
    return `error: the path "${path}" does not exist`;
  }

  const pod = parsePodManifest(content);

  if (!pod) {
    return `error: unable to parse Pod manifest "${path}"`;
  }

  const existingIndex = pods.findIndex(
    (existing) => existing.name === pod.name,
  );

  if (existingIndex === -1) {
    return `Error from server (NotFound): pods "${pod.name}" not found`;
  }

  removePod(pod);

  return `pod "${pod.name}" deleted`;
}

function kubectlManifestAction(action: ManifestAction): string {
  /*
   * Deliberately only applies to `kubectl apply`, not delete.
   */
  if (action.verb === "apply" && isEderaOnEasterEgg(action.filename)) {
    return EDERA_ON_EASTER_EGG;
  }

  if (action.paths.length === 0) {
    return [
      `error: no manifest files matched`,
      "",
      "usage: kubectl <apply|delete> -f <file|directory>",
    ].join("\n");
  }

  const results = action.paths.map((path) =>
    action.verb === "apply" ? applyManifest(path) : deleteManifest(path),
  );

  return results.join("\n");
}

/* -------------------------------------------------------------------------- */
/* RBAC, service accounts and secrets (K02)                                   */
/*                                                                            */
/* Read-only views of the cluster's identity and authorization objects. One   */
/* service account is bound to cluster-admin; finding it means connecting a   */
/* long-lived token Secret, the ServiceAccount it belongs to, and the binding */
/* that grants it everything. The rest are realistic red herrings.           */
/* -------------------------------------------------------------------------- */

interface PolicyRule {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  nonResourceURLs?: string[];
  verbs: string[];
}

interface RoleObject {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  rules: PolicyRule[];
}

interface Subject {
  kind: "ServiceAccount" | "User" | "Group";
  name: string;
  namespace?: string;
}

interface BindingObject {
  name: string;
  namespace?: string;
  annotations?: Record<string, string>;
  roleRef: { kind: "ClusterRole" | "Role"; name: string };
  subjects: Subject[];
  age: string;
}

interface ServiceAccountObject {
  name: string;
  namespace: string;
  age: string;
  tokens?: string[];
  annotations?: Record<string, string>;
}

interface SecretObject {
  name: string;
  namespace: string;
  type: string;
  age: string;
  annotations?: Record<string, string>;
  /* Plaintext values; base64-encoded on output, as the API server does. */
  data: Record<string, string>;
}

const RBAC_DEFAULTS = { "kubernetes.io/bootstrapping": "rbac-defaults" };

const clusterRoles: RoleObject[] = [
  {
    name: "cluster-admin",
    labels: RBAC_DEFAULTS,
    annotations: { "rbac.authorization.kubernetes.io/autoupdate": "true" },
    rules: [
      { apiGroups: ["*"], resources: ["*"], verbs: ["*"] },
      { nonResourceURLs: ["*"], verbs: ["*"] },
    ],
  },
  {
    name: "admin",
    labels: RBAC_DEFAULTS,
    rules: [
      { apiGroups: [""], resources: ["pods", "services", "configmaps", "secrets", "serviceaccounts"], verbs: ["create", "delete", "get", "list", "patch", "update", "watch"] },
      { apiGroups: ["apps"], resources: ["deployments", "statefulsets", "daemonsets"], verbs: ["create", "delete", "get", "list", "patch", "update", "watch"] },
      { apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles", "rolebindings"], verbs: ["create", "delete", "get", "list", "patch", "update", "watch"] },
    ],
  },
  {
    name: "edit",
    labels: RBAC_DEFAULTS,
    rules: [
      { apiGroups: [""], resources: ["pods", "services", "configmaps", "secrets"], verbs: ["create", "delete", "get", "list", "patch", "update", "watch"] },
      { apiGroups: ["apps"], resources: ["deployments", "statefulsets"], verbs: ["create", "delete", "get", "list", "patch", "update", "watch"] },
    ],
  },
  {
    name: "view",
    labels: RBAC_DEFAULTS,
    rules: [
      { apiGroups: [""], resources: ["pods", "services", "configmaps", "namespaces"], verbs: ["get", "list", "watch"] },
      { apiGroups: ["apps"], resources: ["deployments", "statefulsets", "daemonsets"], verbs: ["get", "list", "watch"] },
    ],
  },
  {
    name: "system:basic-user",
    labels: RBAC_DEFAULTS,
    rules: [
      { apiGroups: ["authorization.k8s.io"], resources: ["selfsubjectaccessreviews", "selfsubjectrulesreviews"], verbs: ["create"] },
    ],
  },
  {
    name: "edera-node-agent",
    rules: [
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"] },
      { apiGroups: [""], resources: ["nodes"], verbs: ["get"] },
      { apiGroups: ["node.k8s.io"], resources: ["runtimeclasses"], verbs: ["get", "list"] },
    ],
  },
  {
    name: "cluster-status-reader",
    annotations: { "acme.io/owner": "platform-oncall" },
    rules: [
      { apiGroups: [""], resources: ["pods", "nodes", "namespaces"], verbs: ["get", "list", "watch"] },
    ],
  },
];

const namespacedRoles: RoleObject[] = [
  {
    name: "billing-secret-reader",
    namespace: "customer-b",
    rules: [
      { apiGroups: [""], resources: ["secrets"], resourceNames: ["billing-api-token"], verbs: ["get"] },
    ],
  },
  {
    name: "image-cache-writer",
    namespace: "customer-a",
    rules: [
      { apiGroups: [""], resources: ["configmaps"], verbs: ["get", "update"] },
    ],
  },
];

const clusterRoleBindings: BindingObject[] = [
  {
    name: "cluster-admin",
    roleRef: { kind: "ClusterRole", name: "cluster-admin" },
    subjects: [{ kind: "Group", name: "system:masters" }],
    age: "41d",
  },
  {
    name: "system:basic-user",
    roleRef: { kind: "ClusterRole", name: "system:basic-user" },
    subjects: [{ kind: "Group", name: "system:authenticated" }],
    age: "41d",
  },
  {
    name: "edera-node-agent",
    roleRef: { kind: "ClusterRole", name: "edera-node-agent" },
    subjects: [{ kind: "ServiceAccount", name: "edera-node-agent", namespace: "platform" }],
    age: "41d",
  },
  {
    name: "platform-oncall-view",
    roleRef: { kind: "ClusterRole", name: "view" },
    subjects: [
      { kind: "Group", name: "platform-oncall" },
      { kind: "User", name: "nigel" },
    ],
    age: "33d",
  },
  {
    name: "report-bot-admin",
    roleRef: { kind: "ClusterRole", name: "cluster-admin" },
    subjects: [{ kind: "ServiceAccount", name: "report-bot", namespace: "customer-b" }],
    age: "12d",
  },
  {
    name: "cluster-status-public",
    annotations: { "acme.io/ticket": "OPS-2291 temporary: external uptime checker, remove after migration" },
    roleRef: { kind: "ClusterRole", name: "cluster-status-reader" },
    subjects: [{ kind: "Group", name: "system:unauthenticated" }],
    age: "19d",
  },
];

const roleBindings: BindingObject[] = [
  {
    name: "billing-api-secret-reader",
    namespace: "customer-b",
    roleRef: { kind: "Role", name: "billing-secret-reader" },
    subjects: [{ kind: "ServiceAccount", name: "billing-api", namespace: "customer-b" }],
    age: "38d",
  },
  {
    name: "image-processor-cache",
    namespace: "customer-a",
    roleRef: { kind: "Role", name: "image-cache-writer" },
    subjects: [{ kind: "ServiceAccount", name: "image-processor", namespace: "customer-a" }],
    age: "40d",
  },
  {
    name: "analytics-batch-edit",
    namespace: "customer-d",
    roleRef: { kind: "ClusterRole", name: "edit" },
    subjects: [{ kind: "ServiceAccount", name: "analytics-batch", namespace: "customer-d" }],
    age: "27d",
  },
  {
    name: "recommendation-view",
    namespace: "customer-c",
    roleRef: { kind: "ClusterRole", name: "view" },
    subjects: [{ kind: "ServiceAccount", name: "recommendation", namespace: "customer-c" }],
    age: "35d",
  },
];

const serviceAccounts: ServiceAccountObject[] = [
  ...["default", "customer-a", "customer-b", "customer-c", "customer-d", "platform"].map(
    (namespace) => ({ name: "default", namespace, age: "41d" }),
  ),
  { name: "image-processor", namespace: "customer-a", age: "40d" },
  { name: "billing-api", namespace: "customer-b", age: "38d" },
  {
    name: "report-bot",
    namespace: "customer-b",
    age: "12d",
    tokens: ["report-bot-token"],
    annotations: { "owner": "reporting-integration" },
  },
  { name: "recommendation", namespace: "customer-c", age: "35d" },
  {
    name: "analytics-batch",
    namespace: "customer-d",
    age: "27d",
    annotations: { "eks.amazonaws.com/role-arn": "arn:aws:iam::123456789012:role/AnalyticsExportRole" },
  },
  { name: "edera-node-agent", namespace: "platform", age: "41d" },
];

function fakeJwt(payload: Record<string, string>): string {
  const segment = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${segment({ alg: "RS256", kid: "ctf-lab" })}.${segment(payload)}.bGFiLW9ubHktbm90LWEtcmVhbC1zaWduYXR1cmU`;
}

const LAB_CA = "-----BEGIN CERTIFICATE-----\nlab-only-not-a-real-ca\n-----END CERTIFICATE-----\n";

const secrets: SecretObject[] = [
  {
    name: "image-processor-registry",
    namespace: "customer-a",
    type: "kubernetes.io/dockerconfigjson",
    age: "40d",
    data: { ".dockerconfigjson": '{"auths":{"registry.customer-a.internal":{"auth":"lab-only"}}}' },
  },
  {
    name: "billing-api-token",
    namespace: "customer-b",
    type: "Opaque",
    age: "38d",
    data: { token: "bt-lab-7f3a9c2e5d1b" },
  },
  {
    name: "report-bot-token",
    namespace: "customer-b",
    type: "kubernetes.io/service-account-token",
    age: "12d",
    annotations: {
      "kubernetes.io/service-account.name": "report-bot",
      "kubernetes.io/service-account.uid": "6f1c2a9e-0b7d-4e55-9a51-2c8e7d3b1f40",
    },
    data: {
      "ca.crt": LAB_CA,
      namespace: "customer-b",
      token: fakeJwt({
        iss: "kubernetes/serviceaccount",
        "kubernetes.io/serviceaccount/namespace": "customer-b",
        "kubernetes.io/serviceaccount/secret.name": "report-bot-token",
        "kubernetes.io/serviceaccount/service-account.name": "report-bot",
        sub: "system:serviceaccount:customer-b:report-bot",
      }),
    },
  },
  {
    name: "recommendation-model-key",
    namespace: "customer-c",
    type: "Opaque",
    age: "35d",
    data: { "model-api-key": "lab-only-model-key-0000" },
  },
  {
    name: "analytics-db-credentials",
    namespace: "customer-d",
    type: "Opaque",
    age: "27d",
    data: { username: "analytics", password: "lab-only-password-0000" },
  },
  {
    name: "edera-node-agent-tls",
    namespace: "platform",
    type: "kubernetes.io/tls",
    age: "41d",
    data: { "tls.crt": LAB_CA, "tls.key": "-----BEGIN PRIVATE KEY-----\nlab-only\n-----END PRIVATE KEY-----\n" },
  },
];

/* A small YAML emitter, enough for kubectl -o yaml output. */
function yamlOutScalar(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (text === "") return '""';
  if (
    /^[\s*&!|>'"%@`#,[\]{}?-]|[:#]\s|:$|\s$/.test(text) ||
    /^(true|false|null|yes|no|~|\d[\d.]*)$/i.test(text)
  ) {
    return `'${text.replace(/'/g, "''")}'`;
  }
  return text;
}

function toYaml(value: unknown, indent = ""): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      if (item !== null && typeof item === "object") {
        const inner = toYaml(item, `${indent}  `);
        inner[0] = `${indent}- ${inner[0].slice(indent.length + 2)}`;
        return inner;
      }
      return [`${indent}- ${yamlOutScalar(item)}`];
    });
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .flatMap(([key, entry]) => {
        if (Array.isArray(entry)) {
          return entry.length === 0
            ? [`${indent}${key}: []`]
            : [`${indent}${key}:`, ...toYaml(entry, indent)];
        }
        if (entry !== null && typeof entry === "object") {
          return Object.keys(entry).length === 0
            ? [`${indent}${key}: {}`]
            : [`${indent}${key}:`, ...toYaml(entry, `${indent}  `)];
        }
        return [`${indent}${key}: ${yamlOutScalar(entry)}`];
      });
  }

  return [`${indent}${yamlOutScalar(value)}`];
}

function yamlDocument(items: object[], single: boolean): string {
  if (single) return toYaml(items[0]).join("\n");
  return toYaml({
    apiVersion: "v1",
    items,
    kind: "List",
    metadata: { resourceVersion: "" },
  }).join("\n");
}

function secretManifest(secret: SecretObject): object {
  return {
    apiVersion: "v1",
    data: Object.fromEntries(
      Object.entries(secret.data).map(([key, value]) => [key, btoa(value)]),
    ),
    kind: "Secret",
    metadata: {
      annotations: secret.annotations,
      name: secret.name,
      namespace: secret.namespace,
    },
    type: secret.type,
  };
}

function serviceAccountManifest(account: ServiceAccountObject): object {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      annotations: account.annotations,
      name: account.name,
      namespace: account.namespace,
    },
  };
}

function bindingManifest(binding: BindingObject): object {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: binding.namespace ? "RoleBinding" : "ClusterRoleBinding",
    metadata: { annotations: binding.annotations, name: binding.name, namespace: binding.namespace },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: binding.roleRef.kind,
      name: binding.roleRef.name,
    },
    subjects: binding.subjects.map((subject) => ({
      ...(subject.kind === "ServiceAccount" ? {} : { apiGroup: "rbac.authorization.k8s.io" }),
      kind: subject.kind,
      name: subject.name,
      namespace: subject.namespace,
    })),
  };
}

function roleManifest(role: RoleObject): object {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: role.namespace ? "Role" : "ClusterRole",
    metadata: {
      annotations: role.annotations,
      labels: role.labels,
      name: role.name,
      namespace: role.namespace,
    },
    rules: role.rules,
  };
}

function inScope<T extends { namespace?: string }>(items: T[], flags: KubectlFlags): T[] {
  const scoped = items.filter((item) => flags.allNamespaces || item.namespace === flags.namespace);
  /* kubectl sorts -A output by namespace, then name. */
  return flags.allNamespaces
    ? [...scoped].sort((a, b) => (a.namespace ?? "").localeCompare(b.namespace ?? ""))
    : scoped;
}

function noneFound(flags: KubectlFlags, namespaced: boolean): string {
  return !namespaced || flags.allNamespaces
    ? "No resources found"
    : `No resources found in ${flags.namespace} namespace.`;
}

function withNamespaceColumn(headers: string[], rows: string[][], items: { namespace?: string }[], flags: KubectlFlags): string {
  if (!flags.allNamespaces) return table(headers, rows);
  return table(
    ["NAMESPACE", ...headers],
    rows.map((row, index) => [items[index].namespace ?? "", ...row]),
  );
}

function keyValueBlock(label: string, entries: Record<string, string> | undefined, width: number, separator: string): string[] {
  const pad = (text: string) => text.padEnd(width);
  const pairs = Object.entries(entries ?? {});
  if (pairs.length === 0) return [`${pad(`${label}:`)}<none>`];
  return pairs.map(([key, value], index) =>
    `${index === 0 ? pad(`${label}:`) : " ".repeat(width)}${key}${separator}${value}`,
  );
}

/* ---- Secrets ------------------------------------------------------------ */

function getSecrets(name: string | undefined, flags: KubectlFlags): string {
  const scoped = inScope(secrets, flags);
  const visible = name ? scoped.filter((secret) => secret.name === name) : scoped;

  if (name && visible.length === 0) return notFound("secrets", name);
  if (visible.length === 0) return noneFound(flags, true);

  visible.forEach((secret) => state.secretsSeen.add(`${secret.namespace}/${secret.name}`));

  if (flags.yaml) return yamlDocument(visible.map(secretManifest), Boolean(name));

  return withNamespaceColumn(
    ["NAME", "TYPE", "DATA", "AGE"],
    visible.map((secret) => [secret.name, secret.type, String(Object.keys(secret.data).length), secret.age]),
    visible,
    flags,
  );
}

function describeSecret(secret: SecretObject): string {
  state.secretsSeen.add(`${secret.namespace}/${secret.name}`);
  const keyWidth = Math.max(...Object.keys(secret.data).map((key) => key.length)) + 2;
  return [
    `Name:         ${secret.name}`,
    `Namespace:    ${secret.namespace}`,
    "Labels:       <none>",
    ...keyValueBlock("Annotations", secret.annotations, 14, ": "),
    "",
    `Type:  ${secret.type}`,
    "",
    "Data",
    "====",
    ...Object.entries(secret.data).map(
      ([key, value]) => `${`${key}:`.padEnd(keyWidth)}${value.length} bytes`,
    ),
  ].join("\n");
}

/* ---- Service accounts ----------------------------------------------------- */

function getServiceAccounts(name: string | undefined, flags: KubectlFlags): string {
  const scoped = inScope(serviceAccounts, flags);
  const visible = name ? scoped.filter((account) => account.name === name) : scoped;

  if (name && visible.length === 0) return notFound("serviceaccounts", name);
  if (visible.length === 0) return noneFound(flags, true);

  if (flags.yaml) return yamlDocument(visible.map(serviceAccountManifest), Boolean(name));

  return withNamespaceColumn(
    ["NAME", "SECRETS", "AGE"],
    visible.map((account) => [account.name, "0", account.age]),
    visible,
    flags,
  );
}

function describeServiceAccount(account: ServiceAccountObject): string {
  return [
    `Name:                ${account.name}`,
    `Namespace:           ${account.namespace}`,
    "Labels:              <none>",
    ...keyValueBlock("Annotations", account.annotations, 21, ": "),
    "Image pull secrets:  <none>",
    "Mountable secrets:   <none>",
    `Tokens:              ${account.tokens?.join(", ") ?? "<none>"}`,
    "Events:              <none>",
  ].join("\n");
}

/* ---- Bindings --------------------------------------------------------------- */

function subjectColumn(binding: BindingObject, kind: Subject["kind"]): string {
  return binding.subjects
    .filter((subject) => subject.kind === kind)
    .map((subject) => (kind === "ServiceAccount" ? `${subject.namespace}/${subject.name}` : subject.name))
    .join(", ");
}

function getBindings(
  source: BindingObject[],
  plural: string,
  namespaced: boolean,
  name: string | undefined,
  flags: KubectlFlags,
): string {
  const scoped = namespaced ? inScope(source, flags) : source;
  const visible = name ? scoped.filter((binding) => binding.name === name) : scoped;

  if (name && visible.length === 0) return notFound(plural, name);
  if (visible.length === 0) return noneFound(flags, namespaced);

  if (flags.yaml) return yamlDocument(visible.map(bindingManifest), Boolean(name));

  const headers = ["NAME", "ROLE", "AGE"];
  const rows = visible.map((binding) => [
    binding.name,
    `${binding.roleRef.kind}/${binding.roleRef.name}`,
    binding.age,
  ]);

  if (flags.wide) {
    headers.push("USERS", "GROUPS", "SERVICEACCOUNTS");
    rows.forEach((row, index) => {
      const binding = visible[index];
      row.push(
        subjectColumn(binding, "User"),
        subjectColumn(binding, "Group"),
        subjectColumn(binding, "ServiceAccount"),
      );
    });
  }

  return namespaced ? withNamespaceColumn(headers, rows, visible, flags) : table(headers, rows);
}

function describeBinding(binding: BindingObject): string {
  return [
    `Name:         ${binding.name}`,
    ...(binding.namespace ? [`Namespace:    ${binding.namespace}`] : []),
    "Labels:       <none>",
    ...keyValueBlock("Annotations", binding.annotations, 14, ": "),
    "Role:",
    `  Kind:  ${binding.roleRef.kind}`,
    `  Name:  ${binding.roleRef.name}`,
    "Subjects:",
    table(
      ["  Kind", "Name", "Namespace"],
      [
        ["  ----", "----", "---------"],
        ...binding.subjects.map((subject) => [`  ${subject.kind}`, subject.name, subject.namespace ?? ""]),
      ],
    ),
  ].join("\n");
}

/* ---- Roles -------------------------------------------------------------- */

function ruleResources(rule: PolicyRule): string {
  if (!rule.resources) return "";
  return rule.resources
    .flatMap((resource) =>
      (rule.apiGroups ?? [""]).map((group) => (group ? `${resource}.${group}` : resource)),
    )
    .join(", ");
}

function rulesTable(rules: PolicyRule[], indent = "  "): string {
  return table(
    [`${indent}Resources`, "Non-Resource URLs", "Resource Names", "Verbs"],
    [
      [`${indent}---------`, "-----------------", "--------------", "-----"],
      ...rules.map((rule) => [
        `${indent}${ruleResources(rule)}`,
        `[${(rule.nonResourceURLs ?? []).join(" ")}]`,
        `[${(rule.resourceNames ?? []).join(" ")}]`,
        `[${rule.verbs.join(" ")}]`,
      ]),
    ],
  );
}

function getRoles(
  source: RoleObject[],
  plural: string,
  namespaced: boolean,
  name: string | undefined,
  flags: KubectlFlags,
): string {
  const scoped = namespaced ? inScope(source, flags) : source;
  const visible = name ? scoped.filter((role) => role.name === name) : scoped;

  if (name && visible.length === 0) return notFound(plural, name);
  if (visible.length === 0) return noneFound(flags, namespaced);

  if (flags.yaml) return yamlDocument(visible.map(roleManifest), Boolean(name));

  const rows = visible.map((role) => [role.name, "2026-09-28T09:14:02Z"]);
  return namespaced
    ? withNamespaceColumn(["NAME", "CREATED AT"], rows, visible, flags)
    : table(["NAME", "CREATED AT"], rows);
}

function describeRole(role: RoleObject): string {
  return [
    `Name:         ${role.name}`,
    ...(role.namespace ? [`Namespace:    ${role.namespace}`] : []),
    ...keyValueBlock("Labels", role.labels, 14, "="),
    ...keyValueBlock("Annotations", role.annotations, 14, ": "),
    "PolicyRule:",
    rulesTable(role.rules),
  ].join("\n");
}

/* ---- auth can-i -------------------------------------------------------------- */

interface Identity {
  user: string;
  serviceAccount?: { namespace: string; name: string };
  groups: string[];
}

function identityFrom(as: string | null, asGroups: string[] = []): Identity | null {
  if (!as && asGroups.length === 0) return null;
  if (!as || as === "system:anonymous") {
    return { user: as ?? "system:anonymous", groups: asGroups.length ? asGroups : ["system:unauthenticated"] };
  }
  if (asGroups.length) return { user: as, groups: asGroups };
  const match = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(as);
  if (match) {
    return {
      user: as,
      serviceAccount: { namespace: match[1], name: match[2] },
      groups: ["system:serviceaccounts", `system:serviceaccounts:${match[1]}`, "system:authenticated"],
    };
  }
  return { user: as, groups: ["system:authenticated"] };
}

function subjectMatches(subject: Subject, identity: Identity): boolean {
  if (subject.kind === "ServiceAccount") {
    return (
      identity.serviceAccount?.name === subject.name &&
      identity.serviceAccount.namespace === subject.namespace
    );
  }
  if (subject.kind === "User") return subject.name === identity.user;
  return identity.groups.includes(subject.name);
}

function findRole(ref: BindingObject["roleRef"], namespace?: string): RoleObject | undefined {
  return ref.kind === "ClusterRole"
    ? clusterRoles.find((role) => role.name === ref.name)
    : namespacedRoles.find((role) => role.name === ref.name && role.namespace === namespace);
}

/*
 * Rules that apply to an identity. Cluster-wide checks (-A) only count
 * ClusterRoleBindings; namespaced checks also count that namespace's
 * RoleBindings.
 */
function rulesFor(identity: Identity, namespace: string | null): PolicyRule[] {
  const bindings = [
    ...clusterRoleBindings,
    ...(namespace ? roleBindings.filter((binding) => binding.namespace === namespace) : []),
  ].filter((binding) => binding.subjects.some((subject) => subjectMatches(subject, identity)));

  return bindings.flatMap((binding) => findRole(binding.roleRef, binding.namespace)?.rules ?? []);
}

const RESOURCE_PLURALS: Record<string, string> = {
  pod: "pods", po: "pods", secret: "secrets", node: "nodes", no: "nodes",
  namespace: "namespaces", ns: "namespaces", configmap: "configmaps", cm: "configmaps",
  service: "services", svc: "services", deployment: "deployments", deploy: "deployments",
  serviceaccount: "serviceaccounts", sa: "serviceaccounts",
  role: "roles", rolebinding: "rolebindings", clusterrole: "clusterroles",
  clusterrolebinding: "clusterrolebindings",
};

function ruleAllows(rule: PolicyRule, verb: string, resource: string, resourceName?: string): boolean {
  if (!rule.resources) return false;
  const verbOk = rule.verbs.includes("*") || rule.verbs.includes(verb);
  const resourceOk = rule.resources.includes("*") || rule.resources.includes(resource);
  const nameOk = !rule.resourceNames || (resourceName !== undefined && rule.resourceNames.includes(resourceName));
  return verbOk && resourceOk && nameOk;
}

function kubectlAuth(tokens: string[], flags: KubectlFlags): string {
  const asToken = tokens.find((token) => token.startsWith("--as="));
  const asIndex = tokens.indexOf("--as");
  const as = asToken ? asToken.slice(5) : asIndex !== -1 ? tokens[asIndex + 1] ?? null : null;
  const asGroups = tokens.flatMap((token, index) =>
    token.startsWith("--as-group=") ? [token.slice(11)] : token === "--as-group" && tokens[index + 1] ? [tokens[index + 1]] : [],
  );
  const identity = identityFrom(as, asGroups);
  const namespace = flags.allNamespaces ? null : flags.namespace;

  const words = tokens.filter(
    (token, index) =>
      !token.startsWith("-") &&
      !["-n", "--namespace", "--as", "--as-group", "-o", "--output"].includes(tokens[index - 1] ?? ""),
  );

  if (words[0] !== "auth" || words[1] !== "can-i") {
    return "error: unknown command. Try: kubectl auth can-i <verb> <resource> [--as=<user>] or kubectl auth can-i --list [--as=<user>]";
  }

  /* ivy is the cluster operator running this audit. */
  const rules: PolicyRule[] = identity
    ? rulesFor(identity, namespace)
    : clusterRoles.find((role) => role.name === "cluster-admin")!.rules;

  if (tokens.includes("--list")) {
    const list: PolicyRule[] = [
      ...rules,
      { apiGroups: ["authorization.k8s.io"], resources: ["selfsubjectaccessreviews", "selfsubjectrulesreviews"], verbs: ["create"] },
    ];
    const seen = new Set<string>();
    const rows = list
      .flatMap((rule) =>
        rule.nonResourceURLs
          ? [["", `[${rule.nonResourceURLs.join(" ")}]`, "[]", `[${rule.verbs.join(" ")}]`]]
          : (rule.resources ?? []).flatMap((resource) =>
              (rule.apiGroups ?? [""]).map((group) => [
                group ? `${resource}.${group}` : resource,
                "[]",
                `[${(rule.resourceNames ?? []).join(" ")}]`,
                `[${rule.verbs.join(" ")}]`,
              ]),
            ),
      )
      .filter((row) => {
        const key = row.join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return table(["Resources", "Non-Resource URLs", "Resource Names", "Verbs"], rows);
  }

  const [verb, target] = words.slice(2);
  if (!verb || !target) {
    return "error: you must specify two arguments: verb resource or --list";
  }

  const [resourceRaw, resourceName] = target.split("/");
  const resource = RESOURCE_PLURALS[resourceRaw] ?? resourceRaw;
  const allowed = rules.some((rule) => ruleAllows(rule, verb, resource, resourceName));
  return allowed ? "yes" : "no";
}

/* ---- base64 (for decoding Secret values) --------------------------------- */

function base64Decode(input: string): string {
  const normalised = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  try {
    return atob(padded);
  } catch {
    return "base64: invalid input";
  }
}

/*
 * Supports `base64 -d <value>`, `echo <value> | base64 -d` and
 * `echo <value> | base64 --decode`. Returns null if the command isn't one
 * of those shapes.
 */
function base64Command(raw: string): string | null {
  const piped = /^echo\s+(?:-n\s+)?['"]?([^'"|]+?)['"]?\s*\|\s*base64\s+(?:-d|--decode|-D)\s*$/.exec(raw);
  if (piped) return base64Decode(piped[1]);

  const direct = /^base64\s+(?:-d|--decode|-D)\s+(\S+)\s*$/.exec(raw);
  if (direct) return base64Decode(direct[1]);

  if (/^base64(\s|$)/.test(raw)) return "usage: base64 -d <value>  or  echo <value> | base64 -d";
  return null;
}

/* ---- dispatch ------------------------------------------------------------ */

const RBAC_RESOURCES: Record<string, string> = {
  secret: "secrets", secrets: "secrets",
  sa: "serviceaccounts", serviceaccount: "serviceaccounts", serviceaccounts: "serviceaccounts",
  clusterrolebinding: "clusterrolebindings", clusterrolebindings: "clusterrolebindings",
  rolebinding: "rolebindings", rolebindings: "rolebindings",
  clusterrole: "clusterroles", clusterroles: "clusterroles",
  role: "roles", roles: "roles",
};

function kubectlRbac(verb: string, resource: string, name: string | undefined, flags: KubectlFlags): string | null {
  const kind = RBAC_RESOURCES[resource];
  if (!kind || (verb !== "get" && verb !== "describe")) return null;

  if (verb === "get") {
    switch (kind) {
      case "secrets": return getSecrets(name, flags);
      case "serviceaccounts": return getServiceAccounts(name, flags);
      case "clusterrolebindings": return getBindings(clusterRoleBindings, kind, false, name, flags);
      case "rolebindings": return getBindings(roleBindings, kind, true, name, flags);
      case "clusterroles": return getRoles(clusterRoles, kind, false, name, flags);
      case "roles": return getRoles(namespacedRoles, kind, true, name, flags);
    }
  }

  const describeAll = <T extends { name: string; namespace?: string }>(
    source: T[],
    namespaced: boolean,
    render: (item: T) => string,
  ): string => {
    const scoped = namespaced ? inScope(source, flags) : source;
    const visible = name ? scoped.filter((item) => item.name === name) : scoped;
    if (name && visible.length === 0) return notFound(kind, name);
    if (visible.length === 0) return noneFound(flags, namespaced);
    return visible.map(render).join("\n\n\n");
  };

  switch (kind) {
    case "secrets": return describeAll(secrets, true, describeSecret);
    case "serviceaccounts": return describeAll(serviceAccounts, true, describeServiceAccount);
    case "clusterrolebindings": return describeAll(clusterRoleBindings, false, describeBinding);
    case "rolebindings": return describeAll(roleBindings, true, describeBinding);
    case "clusterroles": return describeAll(clusterRoles, false, describeRole);
    case "roles": return describeAll(namespacedRoles, true, describeRole);
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* kubectl logs (K03)                                                         */
/*                                                                            */
/* billing-api dumps its environment at startup. Its redaction filter only    */
/* matches names containing PASSWORD, so BILLING_TOKEN is logged in plain     */
/* text. The other workloads redact properly and act as red herrings.         */
/* -------------------------------------------------------------------------- */

const podLogs: Record<string, string[]> = {
  "image-processor-a": [
    "2026-11-08T08:12:41.204Z INFO  image-processor 1.4.2 starting",
    "2026-11-08T08:12:41.209Z INFO  config: REGISTRY=registry.customer-a.internal REGISTRY_AUTH=[REDACTED]",
    "2026-11-08T08:12:41.377Z INFO  worker pool started (4 workers)",
    "2026-11-08T08:13:02.018Z INFO  processed thumbnail batch 1182 (64 images, 2.1s)",
    "2026-11-08T08:13:31.552Z INFO  processed thumbnail batch 1183 (64 images, 1.9s)",
    "2026-11-08T08:14:05.330Z WARN  skipped corrupt upload img_88213.heic",
    "2026-11-08T08:14:09.871Z INFO  processed thumbnail batch 1184 (63 images, 2.0s)",
  ],
  "billing-api-b": [
    "2026-11-08T08:14:02.118Z INFO  billing-api 3.0.1 starting",
    "2026-11-08T08:14:02.120Z INFO  loading configuration from environment",
    "2026-11-08T08:14:02.121Z DEBUG env BILLING_REGION=eu-west-1",
    "2026-11-08T08:14:02.121Z DEBUG env BILLING_DB_HOST=billing-db.customer-b.svc.cluster.local",
    "2026-11-08T08:14:02.121Z DEBUG env BILLING_DB_USER=billing",
    "2026-11-08T08:14:02.121Z DEBUG env BILLING_DB_PASSWORD=********",
    "2026-11-08T08:14:02.121Z DEBUG env BILLING_TOKEN=bt-lab-7f3a9c2e5d1b",
    "2026-11-08T08:14:02.122Z DEBUG env LOG_LEVEL=debug",
    "2026-11-08T08:14:02.305Z INFO  connected to billing-db.customer-b.svc.cluster.local:5432",
    "2026-11-08T08:14:02.311Z INFO  listening on :8080",
    "2026-11-08T08:14:12.004Z INFO  GET /healthz 200 1ms",
    "2026-11-08T08:15:47.662Z INFO  POST /v1/invoices 201 48ms",
    "2026-11-08T08:16:20.981Z WARN  payment gateway timeout, retrying (attempt 1/3)",
    "2026-11-08T08:16:21.733Z INFO  POST /v1/invoices 201 802ms",
    "2026-11-08T08:16:42.004Z INFO  GET /healthz 200 1ms remote=10.244.1.1",
    "2026-11-08T08:17:05.271Z INFO  GET /v1/invoices?status=open 200 18ms remote=10.244.1.24",
    "2026-11-08T08:17:31.640Z INFO  GET /v1/customers/export 200 231ms remote=10.244.1.25",
    "2026-11-08T08:17:58.102Z INFO  GET /v1/invoices?status=open 200 16ms remote=10.244.1.24",
    "2026-11-08T08:18:12.004Z INFO  GET /healthz 200 1ms remote=10.244.1.1",
  ],
  "edera-ebpf-test": [
    "2026-11-08T08:11:58.640Z starting eBPF probe test",
    "2026-11-08T08:11:58.702Z attached kprobe: do_sys_openat2",
    "2026-11-08T08:11:58.703Z attached tracepoint: sched/sched_process_exec",
    "2026-11-08T08:12:28.703Z events/s: 412",
    "2026-11-08T08:12:58.703Z events/s: 398",
    "2026-11-08T08:13:28.703Z events/s: 405",
    "2026-11-08T08:18:44.117Z ALERT severity=high rule=exec-from-tmp pod=customer-c/recommendation-c uid=0 parent=/usr/bin/su exe=/tmp/.cache/kworkerd",
    "2026-11-08T08:18:44.131Z ERROR alert sink POST https://alerts.acme.internal/hooks/runtime: 404 Not Found; alert dropped (retries=0)",
    "2026-11-08T08:18:58.703Z events/s: 2193",
    "2026-11-08T08:19:28.703Z events/s: 2207",
  ],
  "analytics-batch-d": [
    "2026-11-08T08:10:00.012Z INFO  analytics-batch 0.9.0 job=nightly-rollup",
    "2026-11-08T08:10:00.014Z INFO  aws: credentials from web identity token (role arn:aws:iam::123456789012:role/AnalyticsExportRole)",
    "2026-11-08T08:10:00.015Z INFO  db: host=analytics-db.customer-d.svc user=analytics password=[REDACTED]",
    "2026-11-08T08:10:03.448Z INFO  rolled up 1,284,113 events into 96 hourly buckets",
    "2026-11-08T08:10:04.102Z ERROR failed to write bucket 2026-11-07T23:00: connection reset by peer",
    "2026-11-08T08:10:05.390Z INFO  retry succeeded for bucket 2026-11-07T23:00",
    "2026-11-08T08:10:05.391Z INFO  uploaded rollup to s3://acme-analytics-exports/2026/11/07/rollup.parquet",
    "2026-11-08T08:10:05.392Z INFO  job complete in 5.4s",
    "2026-11-08T08:17:05.262Z INFO  enriching rollup with invoice totals from billing-api.customer-b.svc:8080",
    "2026-11-08T08:17:05.290Z INFO  fetched 412 open invoices from billing-api.customer-b.svc:8080",
    "2026-11-08T08:17:10.118Z WARN  GET http://recommendation.customer-c.svc:8080/v1/stats timed out after 5s",
  ],
  "recommendation-c": [
    "2026-11-08T08:13:20.550Z INFO  recommendation 2.2.0 starting",
    "2026-11-08T08:13:20.552Z INFO  model endpoint configured (MODEL_API_KEY=***e0f1, 24 chars)",
    "2026-11-08T08:13:22.901Z INFO  warmed model cache (12,400 items)",
    "2026-11-08T08:14:01.337Z INFO  GET /v1/recommendations?user=8812 200 31ms",
    "2026-11-08T08:14:44.019Z INFO  GET /v1/recommendations?user=1907 200 28ms",
    "2026-11-08T08:17:26.402Z WARN  GET http://analytics.customer-d.svc:8080/v1/trending timed out after 5s; using cached trends",
    "2026-11-08T08:17:31.409Z INFO  refreshed customer profiles from billing-api.customer-b.svc:8080 (1,920 records)",
    "2026-11-08T08:18:52.660Z WARN  event loop lag 2,412ms (cpu throttled)",
    "2026-11-08T08:19:20.004Z WARN  GET /v1/recommendations?user=4410 200 1,884ms",
    "2026-11-08T08:19:51.337Z WARN  event loop lag 3,105ms (cpu throttled)",
  ],
  "gpu-workload": [
    "==========",
    "== CUDA ==",
    "==========",
    "CUDA Version 13.3.0",
    "Container image Copyright (c) NVIDIA CORPORATION. All rights reserved.",
    "[workload] device 0: NVIDIA L4 (zone passthrough)",
    "[workload] batch 1/50 complete",
  ],
};

function kubectlLogs(head: string[], target: string | undefined, flags: KubectlFlags): string {
  let candidates: Pod[];

  if (flags.selector) {
    candidates = scopedPods(flags);
    if (candidates.length === 0) return noneFound(flags, true);
  } else {
    if (!target) {
      return "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command";
    }
    const name = target.includes("/") ? target.split("/").slice(1).join("/") : target;
    const pod = resolvePod(name, { ...flags, allNamespaces: false });
    if (!pod) return notFound("pods", name);
    candidates = [pod];
  }

  const tailToken = head.find((token) => token.startsWith("--tail="));
  const tailIndex = head.indexOf("--tail");
  const tail = Number(tailToken ? tailToken.slice(7) : tailIndex !== -1 ? head[tailIndex + 1] : NaN);

  const output = candidates.flatMap((pod) => {
    const lines = podLogs[pod.name] ?? [`${pod.app}: started`];
    return Number.isFinite(tail) && tail >= 0 ? lines.slice(Math.max(0, lines.length - tail)) : lines;
  });

  return output.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Namespaces, Kyverno ClusterPolicy and the blocked tenant (K04)             */
/*                                                                            */
/* A Kyverno ClusterPolicy in Enforce mode denies Pods in any namespace that  */
/* has not been onboarded with edera.dev/isolation=enforced. customer-e was    */
/* created without the label, so its payments-worker Deployment sits at 0/1   */
/* while Kyverno rejects every Pod its ReplicaSet tries to create. Labelling  */
/* the namespace lets the next retry through, and the Pod starts in a zone.   */
/* -------------------------------------------------------------------------- */

function allNamespaceLabels(namespace: string): Record<string, string> {
  return { "kubernetes.io/metadata.name": namespace, ...(namespaceLabels[namespace] ?? {}) };
}

function namespaceNames(): string[] {
  return [...new Set([...Object.keys(namespaceLabels), ...pods.map((pod) => pod.namespace)])].sort();
}

/* Unknown namespaces are left alone so ad-hoc manifests keep working. */
function isOnboarded(namespace: string): boolean {
  const labels = namespaceLabels[namespace];
  return !labels || labels[ONBOARDING_KEY] === ONBOARDING_VALUE;
}

function kyvernoDenial(namespace: string, podName = ""): string {
  return [
    `admission webhook "validate.kyverno.svc-fail" denied the request:`,
    "",
    `resource Pod/${namespace}/${podName} was blocked due to the following policies`,
    "",
    `${ONBOARDING_POLICY}:`,
    `  ${ONBOARDING_RULE}: 'Pod admission denied: namespace ${namespace} is not onboarded to Edera isolation.'`,
  ].join("\n");
}

const PAYMENTS = {
  deployment: "payments-worker",
  replicaSet: "payments-worker-6d8f7b9c4",
  pod: "payments-worker-6d8f7b9c4-x2k9q",
  zone: "zone-customer-e",
  image: "ghcr.io/acme/payments-worker:1.0.3",
};

zoneTemplates.set(PAYMENTS.zone, {
  name: PAYMENTS.zone,
  id: "z-91d3f2",
  state: "ready",
  cpus: 2,
  memory: "2048MB",
  kernel: ZONE_KERNEL,
  pod: PAYMENTS.pod,
});

podLogs[PAYMENTS.pod] = [
  "2026-11-08T16:02:11.402Z INFO  payments-worker 1.0.3 starting",
  "2026-11-08T16:02:11.407Z INFO  queue: payments.customer-e (prefetch=16)",
  "2026-11-08T16:02:11.612Z INFO  ready, waiting for jobs",
];

function paymentsPod(): Pod | undefined {
  return pods.find((pod) => pod.name === PAYMENTS.pod);
}

/* Admit the Pod the ReplicaSet keeps retrying, now that policy allows it. */
function admitPaymentsWorker(): Pod {
  const pod: Pod = {
    name: PAYMENTS.pod,
    namespace: BLOCKED_NAMESPACE,
    app: PAYMENTS.deployment,
    node: NODE.name,
    status: "Running",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "2048",
    },
    zone: PAYMENTS.zone,
    image: PAYMENTS.image,
  };
  pods.push(pod);
  syncZoneForPod(pod);
  return pod;
}

/* ---- Namespaces ------------------------------------------------------------ */

function namespaceLabelString(namespace: string): string {
  return Object.entries(allNamespaceLabels(namespace))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function getNamespaces(name: string | undefined, flags: KubectlFlags): string {
  const names = namespaceNames();
  const visible = name ? names.filter((namespace) => namespace === name) : names;

  if (name && visible.length === 0) return notFound("namespaces", name);
  if (name === BLOCKED_NAMESPACE || !name) state.blockedTenantSeen = true;

  if (flags.yaml) {
    return yamlDocument(
      visible.map((namespace) => ({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { labels: allNamespaceLabels(namespace), name: namespace },
        spec: { finalizers: ["kubernetes"] },
        status: { phase: "Active" },
      })),
      Boolean(name),
    );
  }

  const headers = ["NAME", "STATUS", "AGE"];
  const rows = visible.map((namespace) => [
    namespace,
    "Active",
    namespace === BLOCKED_NAMESPACE ? "2d" : "41d",
  ]);

  if (flags.showLabels) {
    headers.push("LABELS");
    rows.forEach((row, index) => row.push(namespaceLabelString(visible[index])));
  }

  return table(headers, rows);
}

function describeNamespace(name: string | undefined): string {
  const names = name ? [name] : namespaceNames();
  if (name && !namespaceNames().includes(name)) return notFound("namespaces", name);
  if (!name || name === BLOCKED_NAMESPACE) state.blockedTenantSeen = true;

  return names
    .map((namespace) =>
      [
        `Name:         ${namespace}`,
        ...keyValueBlock("Labels", allNamespaceLabels(namespace), 14, "="),
        "Annotations:  <none>",
        "Status:       Active",
        "",
        "No resource quota.",
        "",
        "No LimitRange resource.",
      ].join("\n"),
    )
    .join("\n\n\n");
}

function kubectlLabel(positional: string[], head: string[]): string {
  const [, rawResource, rawName, ...rest] = positional;
  const slashed = rawResource?.includes("/");
  const resource = slashed ? rawResource.split("/")[0] : rawResource;
  const name = slashed ? rawResource.split("/").slice(1).join("/") : rawName;
  const changes = slashed ? [rawName, ...rest].filter(Boolean) : rest;

  if (!resource) return "error: resource(s) were provided, but no name was specified";

  if (!["ns", "namespace", "namespaces"].includes(resource)) {
    return `error: this lab only supports labelling namespaces (got "${resource}")`;
  }

  if (!name) return "error: resource(s) were provided, but no name was specified";
  if (!namespaceNames().includes(name)) return notFound("namespaces", name);
  if (changes.length === 0) return "error: at least one label update is required";

  const overwrite = head.includes("--overwrite");
  const labels = { ...(namespaceLabels[name] ?? {}) };
  let changed = false;

  for (const change of changes) {
    if (change.endsWith("-") && !change.includes("=")) {
      const key = change.slice(0, -1);
      if (key in labels) {
        delete labels[key];
        changed = true;
      }
      continue;
    }

    const separator = change.indexOf("=");
    if (separator <= 0) return `error: invalid label spec: ${change}`;

    const key = change.slice(0, separator);
    const value = change.slice(separator + 1);

    if (key in labels && labels[key] !== value && !overwrite) {
      return `error: '${key}' already has a value (${labels[key]}), and --overwrite is false`;
    }
    if (labels[key] !== value) {
      labels[key] = value;
      changed = true;
    }
  }

  if (!changed) return `namespace/${name} not labeled`;

  namespaceLabels[name] = labels;
  const output = [`namespace/${name} labeled`];

  if (name === BLOCKED_NAMESPACE && isOnboarded(name) && !paymentsPod()) {
    state.blockedTenantSeen = true;
    const pod = admitPaymentsWorker();
    output.push(
      "",
      `Kyverno: ClusterPolicy ${ONBOARDING_POLICY} now admits Pods in ${name}.`,
      `replicaset/${PAYMENTS.replicaSet} retried and created pod/${pod.name}: Running in ${pod.zone}.`,
    );

    if (currentStage()?.flag === K04_FLAG) {
      output.push("", captureCurrentStage());
    }
  }

  return output.join("\n");
}

/* ---- Kyverno ClusterPolicy ------------------------------------------------- */

const ONBOARDING_POLICY_YAML = [
  "apiVersion: kyverno.io/v1",
  "kind: ClusterPolicy",
  "metadata:",
  "  annotations:",
  "    policies.kyverno.io/category: Multi-Tenancy",
  "    policies.kyverno.io/severity: high",
  "    policies.kyverno.io/title: Edera tenant onboarding",
  `  name: ${ONBOARDING_POLICY}`,
  "spec:",
  "  admission: true",
  "  background: true",
  "  rules:",
  `  - name: ${ONBOARDING_RULE}`,
  "    match:",
  "      any:",
  "      - resources:",
  "          kinds:",
  "          - Pod",
  "    exclude:",
  "      any:",
  "      - resources:",
  "          namespaces:",
  "          - kube-system",
  "          - kyverno",
  "      - resources:",
  "          namespaceSelector:",
  "            matchLabels:",
  `              ${ONBOARDING_KEY}: ${ONBOARDING_VALUE}`,
  "    validate:",
  "      failureAction: Enforce",
  "      message: 'Pod admission denied: namespace {{request.namespace}} is not onboarded",
  "        to Edera isolation.'",
  "      deny: {}",
  "status:",
  "  conditions:",
  "  - reason: Succeeded",
  "    status: \"True\"",
  "    type: Ready",
].join("\n");

function getClusterPolicies(name: string | undefined, flags: KubectlFlags): string {
  if (name && name !== ONBOARDING_POLICY) return notFound("clusterpolicies.kyverno.io", name);
  state.blockedTenantSeen = true;

  if (flags.yaml) {
    if (name) return ONBOARDING_POLICY_YAML;
    return [
      "apiVersion: v1",
      "items:",
      ...ONBOARDING_POLICY_YAML.split("\n").map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`)),
      "kind: List",
      "metadata:",
      '  resourceVersion: ""',
    ].join("\n");
  }

  return table(
    ["NAME", "ADMISSION", "BACKGROUND", "READY", "AGE", "MESSAGE"],
    [[ONBOARDING_POLICY, "true", "true", "True", "9d", "Ready"]],
  );
}

function describeClusterPolicy(name: string | undefined): string {
  if (name && name !== ONBOARDING_POLICY) return notFound("clusterpolicies.kyverno.io", name);
  state.blockedTenantSeen = true;

  return [
    `Name:         ${ONBOARDING_POLICY}`,
    "Namespace:",
    "Labels:       <none>",
    "Annotations:  policies.kyverno.io/category: Multi-Tenancy",
    "              policies.kyverno.io/severity: high",
    "              policies.kyverno.io/title: Edera tenant onboarding",
    "API Version:  kyverno.io/v1",
    "Kind:         ClusterPolicy",
    "Spec:",
    "  Admission:   true",
    "  Background:  true",
    "  Rules:",
    "    Exclude:",
    "      Any:",
    "        Resources:",
    "          Namespaces:",
    "            kube-system",
    "            kyverno",
    "        Resources:",
    "          Namespace Selector:",
    "            Match Labels:",
    `              ${ONBOARDING_KEY}:  ${ONBOARDING_VALUE}`,
    "    Match:",
    "      Any:",
    "        Resources:",
    "          Kinds:",
    "            Pod",
    `    Name:  ${ONBOARDING_RULE}`,
    "    Validate:",
    "      Deny:",
    "      Failure Action:  Enforce",
    "      Message:         Pod admission denied: namespace {{request.namespace}} is not onboarded to Edera isolation.",
    "Status:",
    "  Conditions:",
    "    Reason:  Succeeded",
    "    Status:  True",
    "    Type:    Ready",
    "Events:      <none>",
  ].join("\n");
}

/* ---- Deployments and events -------------------------------------------- */

function paymentsReady(): boolean {
  return Boolean(paymentsPod());
}

function getDeployments(name: string | undefined, flags: KubectlFlags): string {
  const inScopeNs = flags.allNamespaces || flags.namespace === BLOCKED_NAMESPACE;
  if (name && (name !== PAYMENTS.deployment || !inScopeNs)) {
    return notFound("deployments.apps", name);
  }
  if (!inScopeNs) return noneFound(flags, true);

  state.blockedTenantSeen = true;
  const ready = paymentsReady() ? "1" : "0";

  if (flags.yaml) {
    return toYaml({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: PAYMENTS.deployment, namespace: BLOCKED_NAMESPACE },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: PAYMENTS.deployment } },
        template: {
          metadata: { labels: { app: PAYMENTS.deployment } },
          spec: {
            containers: [{ image: PAYMENTS.image, name: PAYMENTS.deployment }],
            runtimeClassName: "edera",
          },
        },
      },
      status: { availableReplicas: Number(ready), readyReplicas: Number(ready), replicas: Number(ready) },
    }).join("\n");
  }

  const headers = ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"];
  const row = [PAYMENTS.deployment, `${ready}/1`, ready, ready, "2d"];
  return flags.allNamespaces
    ? table(["NAMESPACE", ...headers], [[BLOCKED_NAMESPACE, ...row]])
    : table(headers, [row]);
}

function describeDeployment(name: string | undefined, flags: KubectlFlags): string {
  const inScopeNs = flags.allNamespaces || flags.namespace === BLOCKED_NAMESPACE;
  if (!inScopeNs || (name && name !== PAYMENTS.deployment)) {
    return name ? notFound("deployments.apps", name) : noneFound(flags, true);
  }

  state.blockedTenantSeen = true;
  const ready = paymentsReady();

  return [
    `Name:                   ${PAYMENTS.deployment}`,
    `Namespace:              ${BLOCKED_NAMESPACE}`,
    `Selector:               app=${PAYMENTS.deployment}`,
    `Replicas:               1 desired | ${ready ? 1 : 0} updated | ${ready ? 1 : 0} total | ${ready ? 1 : 0} available | ${ready ? 0 : 1} unavailable`,
    "StrategyType:           RollingUpdate",
    "Pod Template:",
    `  Labels:  app=${PAYMENTS.deployment}`,
    "  Containers:",
    `   ${PAYMENTS.deployment}:`,
    `    Image:  ${PAYMENTS.image}`,
    "  Runtime Class Name:  edera",
    "Conditions:",
    "  Type             Status  Reason",
    "  ----             ------  ------",
    ...(ready
      ? ["  Available        True    MinimumReplicasAvailable", "  Progressing      True    NewReplicaSetAvailable"]
      : [
          "  Available        False   MinimumReplicasUnavailable",
          "  ReplicaFailure   True    FailedCreate",
          "  Progressing      False   ProgressDeadlineExceeded",
        ]),
    `NewReplicaSet:      ${PAYMENTS.replicaSet} (${ready ? 1 : 0}/1 replicas created)`,
    "Events:",
    "  Type    Reason             Age   From                   Message",
    "  ----    ------             ----  ----                   -------",
    `  Normal  ScalingReplicaSet  2d    deployment-controller  Scaled up replica set ${PAYMENTS.replicaSet} to 1`,
  ].join("\n");
}

function getEvents(flags: KubectlFlags): string {
  const showTenant = flags.allNamespaces || flags.namespace === BLOCKED_NAMESPACE;
  const showPolicy = flags.allNamespaces || flags.namespace === "default";
  if (!showTenant && !showPolicy) return noneFound(flags, true);

  state.blockedTenantSeen = true;
  const denial = `Error creating: ${kyvernoDenial(BLOCKED_NAMESPACE).replace(/\s*\n+\s*/g, " ")}`;
  const rows: string[][] = [];

  if (showPolicy) {
    rows.push([
      "default", "64s", "Warning", "PolicyViolation", `clusterpolicy/${ONBOARDING_POLICY}`,
      `Pod ${BLOCKED_NAMESPACE}/: [${ONBOARDING_RULE}] fail (blocked); Pod admission denied: namespace ${BLOCKED_NAMESPACE} is not onboarded to Edera isolation.`,
    ]);
  }

  if (showTenant) {
    rows.push([BLOCKED_NAMESPACE, "64s", "Warning", "FailedCreate", `replicaset/${PAYMENTS.replicaSet}`, denial]);
    if (paymentsReady()) {
      rows.push(
        [BLOCKED_NAMESPACE, "8s", "Normal", "SuccessfulCreate", `replicaset/${PAYMENTS.replicaSet}`, `Created pod: ${PAYMENTS.pod}`],
        [BLOCKED_NAMESPACE, "8s", "Normal", "Scheduled", `pod/${PAYMENTS.pod}`, `Successfully assigned ${BLOCKED_NAMESPACE}/${PAYMENTS.pod} to ${NODE.name}`],
        [BLOCKED_NAMESPACE, "6s", "Normal", "Started", `pod/${PAYMENTS.pod}`, `Started container ${PAYMENTS.deployment} in ${PAYMENTS.zone}`],
      );
    }
  }

  const headers = ["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"];
  return flags.allNamespaces
    ? table(["NAMESPACE", ...headers], rows)
    : table(headers, rows.map((row) => row.slice(1)));
}

/* -------------------------------------------------------------------------- */
/* NetworkPolicies (K05)                                                      */
/*                                                                            */
/* Every tenant has a default-deny plus scoped allows, except customer-b,     */
/* which relies on one policy for billing-api. Its podSelector says           */
/* app=biling-api (one "l"), matches no pods, and so isolates nothing:        */
/* billing-api accepts traffic from every namespace. The pod logs show it.    */
/* -------------------------------------------------------------------------- */

type LabelSelector = Record<string, string>;

interface NetworkPolicyPeer {
  podSelector?: LabelSelector;
  namespaceSelector?: LabelSelector;
}

interface NetworkPolicyObject {
  name: string;
  namespace: string;
  podSelector: LabelSelector;
  ingress?: { from?: NetworkPolicyPeer[]; ports?: { port: number; protocol: string }[] }[];
  policyTypes: string[];
  created: string;
  age: string;
}

const networkPolicies: NetworkPolicyObject[] = [
  ...["customer-a", "customer-c", "customer-d", "platform", "customer-e"].map((namespace) => ({
    name: "default-deny-ingress",
    namespace,
    podSelector: {},
    policyTypes: ["Ingress"],
    created: namespace === "customer-e" ? "2026-11-06 15:58:40" : "2026-09-28 09:20:11",
    age: namespace === "customer-e" ? "2d" : "41d",
  })),
  {
    name: "allow-image-uploads",
    namespace: "customer-a",
    podSelector: { app: "image-processor" },
    ingress: [
      {
        from: [{ namespaceSelector: { "kubernetes.io/metadata.name": "customer-a" } }],
        ports: [{ port: 8080, protocol: "TCP" }],
      },
    ],
    policyTypes: ["Ingress"],
    created: "2026-09-29 11:02:47",
    age: "40d",
  },
  {
    name: "billing-api-ingress",
    namespace: "customer-b",
    podSelector: { app: "biling-api" },
    ingress: [
      {
        from: [{ podSelector: {} }],
        ports: [{ port: 8080, protocol: "TCP" }],
      },
    ],
    policyTypes: ["Ingress"],
    created: "2026-10-01 16:44:09",
    age: "38d",
  },
  {
    name: "allow-recommendation-api",
    namespace: "customer-c",
    podSelector: { app: "recommendation" },
    ingress: [
      {
        from: [{ podSelector: {} }],
        ports: [{ port: 8080, protocol: "TCP" }],
      },
    ],
    policyTypes: ["Ingress"],
    created: "2026-10-04 10:15:32",
    age: "35d",
  },
  {
    name: "allow-metrics-scrape",
    namespace: "customer-d",
    podSelector: { app: "analytics-batch" },
    ingress: [
      {
        from: [{ namespaceSelector: { "kubernetes.io/metadata.name": "platform" } }],
        ports: [{ port: 9090, protocol: "TCP" }],
      },
    ],
    policyTypes: ["Ingress"],
    created: "2026-10-12 08:37:55",
    age: "27d",
  },
];

function selectorString(selector: LabelSelector): string {
  const pairs = Object.entries(selector);
  return pairs.length === 0 ? "<none>" : pairs.map(([key, value]) => `${key}=${value}`).join(",");
}

function networkPolicyManifest(policy: NetworkPolicyObject): object {
  const selector = (labels: LabelSelector) =>
    Object.keys(labels).length === 0 ? {} : { matchLabels: labels };

  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: policy.name, namespace: policy.namespace },
    spec: {
      ingress: policy.ingress?.map((rule) => ({
        from: rule.from?.map((peer) => ({
          namespaceSelector: peer.namespaceSelector && selector(peer.namespaceSelector),
          podSelector: peer.podSelector && selector(peer.podSelector),
        })),
        ports: rule.ports,
      })),
      podSelector: selector(policy.podSelector),
      policyTypes: policy.policyTypes,
    },
  };
}

function getNetworkPolicies(name: string | undefined, flags: KubectlFlags): string {
  const scoped = inScope(networkPolicies, flags);
  const visible = name ? scoped.filter((policy) => policy.name === name) : scoped;

  if (name && visible.length === 0) return notFound("networkpolicies.networking.k8s.io", name);
  if (visible.length === 0) return noneFound(flags, true);

  if (flags.yaml) return yamlDocument(visible.map(networkPolicyManifest), Boolean(name));

  return withNamespaceColumn(
    ["NAME", "POD-SELECTOR", "AGE"],
    visible.map((policy) => [policy.name, selectorString(policy.podSelector), policy.age]),
    visible,
    flags,
  );
}

function describeNetworkPolicy(policy: NetworkPolicyObject): string {
  const podSelector = Object.keys(policy.podSelector).length === 0
    ? "<none> (Allowing the specific traffic to all pods in this namespace)"
    : selectorString(policy.podSelector);

  const ingress = policy.ingress?.length
    ? policy.ingress.flatMap((rule) => [
        ...(rule.ports ?? []).map((port) => `    To Port: ${port.port}/${port.protocol}`),
        "    From:",
        ...(rule.from ?? []).flatMap((peer) => [
          ...(peer.namespaceSelector ? [`      NamespaceSelector: ${selectorString(peer.namespaceSelector)}`] : []),
          ...(peer.podSelector ? [`      PodSelector: ${selectorString(peer.podSelector)}`] : []),
        ]),
      ])
    : ["    <none> (Selected pods are isolated for ingress connectivity)"];

  return [
    `Name:         ${policy.name}`,
    `Namespace:    ${policy.namespace}`,
    `Created on:   ${policy.created} +0000 UTC`,
    "Labels:       <none>",
    "Annotations:  <none>",
    "Spec:",
    `  PodSelector:     ${podSelector}`,
    "  Allowing ingress traffic:",
    ...ingress,
    "  Not affecting egress traffic",
    `  Policy Types: ${policy.policyTypes.join(", ")}`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* API server exposure (K06)                                                  */
/*                                                                            */
/* As in a default cluster, the API server answers /version, /healthz,       */
/* /livez and /readyz for anonymous callers (system:public-info-viewer), and  */
/* 403s everything else. /version leaks the exact, out-of-support build.      */
/* Reachable from the node (10.10.0.10:6443) and from inside any pod via      */
/* kubernetes.default.svc.                                                    */
/* -------------------------------------------------------------------------- */

const API_SERVER = { host: "10.10.0.10", port: 6443, serviceIp: "10.96.0.1" };
const CLIENT_VERSION = "v1.34.1";

const SERVER_VERSION = {
  major: "1",
  minor: "30",
  gitVersion: "v1.30.2",
  gitCommit: "39683505b630ff2121012f3c5b16215a1449d5ed",
  gitTreeState: "clean",
  buildDate: "2024-06-11T20:21:00Z",
  goVersion: "go1.22.4",
  compiler: "gc",
  platform: "linux/amd64",
};

const ANONYMOUS_PATHS = new Set(["/version", "/healthz", "/livez", "/readyz"]);

function apiResponse(path: string): { status: number; body: string } {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";

  if (clean === "/version") {
    return { status: 200, body: JSON.stringify(SERVER_VERSION, null, 2) };
  }
  if (ANONYMOUS_PATHS.has(clean)) return { status: 200, body: "ok" };

  const forbidden = (message: string) => ({
    status: 403,
    body: JSON.stringify(
      {
        kind: "Status",
        apiVersion: "v1",
        metadata: {},
        status: "Failure",
        message,
        reason: "Forbidden",
        details: {},
        code: 403,
      },
      null,
      2,
    ),
  });

  /* Core API resource paths, checked against RBAC as system:anonymous. */
  const match = /^\/api\/v1(?:\/namespaces\/([^/]+))?\/([a-z]+)(?:\/([^/]+))?$/.exec(clean);
  if (!match) return forbidden(`forbidden: User "system:anonymous" cannot get path "${clean}"`);

  const [, namespace, resource, name] = match;
  const verb = name ? "get" : "list";
  const anonymous = identityFrom("system:anonymous")!;
  const allowed = rulesFor(anonymous, namespace ?? null).some((rule) => ruleAllows(rule, verb, resource, name));

  if (!allowed) {
    const scope = namespace ? `in the namespace "${namespace}"` : "at the cluster scope";
    return forbidden(
      `${resource}${name ? ` "${name}"` : ""} is forbidden: User "system:anonymous" cannot ${verb} resource "${resource}" in API group "" ${scope}`,
    );
  }

  return { status: 200, body: JSON.stringify(anonymousList(resource, namespace, name), null, 2) };
}

/* What an anonymous caller gets back for the resources they can read. */
function anonymousList(resource: string, namespace: string | undefined, name: string | undefined): object {
  const listOf = (kind: string, items: object[]) =>
    name ? items[0] ?? { kind: "Status", status: "Failure", reason: "NotFound", code: 404 } : {
      kind: `${kind}List`,
      apiVersion: "v1",
      metadata: { resourceVersion: "482913" },
      items,
    };

  if (resource === "pods") {
    const visible = pods.filter(
      (pod) => (!namespace || pod.namespace === namespace) && (!name || pod.name === name),
    );
    return listOf("Pod", visible.map((pod) => ({
      metadata: { name: pod.name, namespace: pod.namespace, labels: labelsFor(pod) },
      spec: {
        nodeName: pod.node,
        runtimeClassName: pod.runtimeClass ?? undefined,
        serviceAccountName: serviceAccountFor(pod)?.name ?? "default",
        containers: [{ name: pod.app, image: pod.image }],
      },
      status: { phase: pod.status, podIP: podIp(pod) },
    })));
  }

  if (resource === "namespaces") {
    const names = namespaceNames().filter((candidate) => !name || candidate === name);
    return listOf("Namespace", names.map((candidate) => ({
      metadata: { name: candidate, labels: allNamespaceLabels(candidate) },
      status: { phase: "Active" },
    })));
  }

  if (resource === "nodes") {
    return listOf("Node", [{
      metadata: { name: NODE.name, labels: NODE.labels },
      status: {
        addresses: [{ type: "InternalIP", address: NODE.ip }],
        nodeInfo: { kernelVersion: NODE.kernelVersion, osImage: NODE.os, containerRuntimeVersion: NODE.runtime },
      },
    }]);
  }

  return { kind: "Status", status: "Failure", reason: "NotFound", code: 404 };
}

const CURL_TLS_ERROR = [
  "curl: (60) SSL certificate problem: unable to get local issuer certificate",
  "More details here: https://curl.se/docs/sslcerts.html",
  "",
  "curl failed to verify the legitimacy of the server and therefore could not",
  "establish a secure connection to it. To learn more about this situation and",
  "how to fix it, please visit the web page mentioned above.",
].join("\n");

/*
 * A small curl: enough to talk to the API server anonymously. `inPod` adds
 * the in-cluster service names and the mounted service account CA.
 */
function curlCommand(args: string[], inPod: boolean): string {
  const valueFlags = new Set(["-H", "--header", "-X", "--request", "-o", "--output", "--cacert", "-d", "--data", "-u", "--user"]);
  let url: string | undefined;
  let insecure = false;
  let includeHeaders = false;
  let caCert: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (valueFlags.has(arg)) {
      if (arg === "--cacert") caCert = args[index + 1];
      index++;
      continue;
    }
    if (arg === "-k" || arg === "--insecure") insecure = true;
    else if (arg === "-i" || arg === "--include") includeHeaders = true;
    else if (/^-[a-zA-Z]+$/.test(arg)) {
      if (arg.includes("k")) insecure = true;
      if (arg.includes("i")) includeHeaders = true;
    } else if (!arg.startsWith("-")) url = url ?? arg.replace(/^['"]|['"]$/g, "");
  }

  if (!url) return "curl: try 'curl --help' or 'curl --manual' for more information";

  const match = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!match) return `curl: (3) URL rejected: Malformed input to a URL function`;

  const scheme = match[1] ?? "http";
  const host = match[2];
  const port = Number(match[3] ?? (scheme === "https" ? 443 : 80));
  const path = match[4] ?? "/";

  const inClusterNames = ["kubernetes", "kubernetes.default", "kubernetes.default.svc", "kubernetes.default.svc.cluster.local"];
  const isApiServer =
    (host === API_SERVER.host && port === API_SERVER.port) ||
    (inPod && (inClusterNames.includes(host) || host === API_SERVER.serviceIp) && port === 443);

  /* The kubelet has anonymous auth disabled, so it rejects anonymous calls. */
  const isKubelet = (host === NODE.ip || host === "localhost" || host === "127.0.0.1") && port === 10250;
  if (isKubelet) {
    if (scheme === "http") return "Client sent an HTTP request to an HTTPS server.";
    if (!insecure) return CURL_TLS_ERROR;
    return [...(includeHeaders ? ["HTTP/2 401 ", "content-type: text/plain; charset=utf-8", ""] : []), "Unauthorized"].join("\n");
  }

  if (!isApiServer) {
    if (!inPod && inClusterNames.includes(host)) return `curl: (6) Could not resolve host: ${host}`;
    if (/^[\d.]+$/.test(host) || host === "localhost") {
      return `curl: (7) Failed to connect to ${host} port ${port} after 3 ms: Couldn't connect to server`;
    }
    return `curl: (6) Could not resolve host: ${host}`;
  }

  if (scheme === "http") return "Client sent an HTTP request to an HTTPS server.";

  const trustedCa = inPod && caCert === "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
  if (!insecure && !trustedCa) return CURL_TLS_ERROR;

  const response = apiResponse(path);
  const contentType = response.body.startsWith("{") ? "application/json" : "text/plain; charset=utf-8";
  const headers = [
    `HTTP/2 ${response.status} `,
    "audit-id: 5e0c7a1d-2f43-4b8e-9c61-0d7f3a9b2e84",
    "cache-control: no-cache, private",
    `content-type: ${contentType}`,
    "x-kubernetes-pf-flowschema-uid: 8a6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
    "",
  ];

  return [...(includeHeaders ? headers : []), response.body].join("\n");
}

function kubectlVersion(): string {
  return [
    `Client Version: ${CLIENT_VERSION}`,
    "Kustomize Version: v5.7.1",
    `Server Version: ${SERVER_VERSION.gitVersion}`,
    "Warning: version difference between client (1.34) and server (1.30) exceeds the supported minor version skew of +/-1",
  ].join("\n");
}

function kubectlClusterInfo(): string {
  return [
    `Kubernetes control plane is running at https://${API_SERVER.host}:${API_SERVER.port}`,
    `CoreDNS is running at https://${API_SERVER.host}:${API_SERVER.port}/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy`,
    "",
    "To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.",
  ].join("\n");
}

function kubectlGetRaw(path: string | undefined): string {
  if (!path) return "error: --raw requires a path, e.g. kubectl get --raw /version";
  if (path === "/version") return JSON.stringify(SERVER_VERSION, null, 2);
  if (["/healthz", "/livez", "/readyz"].includes(path)) return "ok";
  return `Error from server (NotFound): the server could not find the requested resource`;
}

function kubectl(raw: string): string {
  const tokens = raw.split(/\s+/).slice(1);
  const manifestAction = parseManifestAction(tokens);

  if (manifestAction) {
    return kubectlManifestAction(manifestAction);
  }

  const separator = tokens.indexOf("--");
  const head = separator === -1 ? tokens : tokens.slice(0, separator);
  const tail = separator === -1 ? [] : tokens.slice(separator + 1);

  const positional = head.filter(
    (token, index) =>
      !token.startsWith("-") &&
      !["-n", "--namespace", "-o", "--output", "-l", "--selector", "--as", "--as-group", "--tail", "-c", "--container"].includes(
        head[index - 1] ?? "",
      ),
  );

  const [verb, rawResource, rawName] = positional;
  const flags = parseFlags(head);

  if (!verb) return kubectlUsage();

  if (verb === "auth") return kubectlAuth(head, flags);
  if (verb === "version") return kubectlVersion();
  if (verb === "cluster-info") return kubectlClusterInfo();
  if (verb === "get" && head.some((token) => token === "--raw" || token.startsWith("--raw="))) {
    const inline = head.find((token) => token.startsWith("--raw="));
    return kubectlGetRaw(inline ? inline.slice(6) : head[head.indexOf("--raw") + 1]);
  }
  if (verb === "logs" || verb === "log") return kubectlLogs(head, rawResource, flags);
  if (verb === "label") return kubectlLabel(positional, head);

  /* Accept kubectl's `<resource>/<name>` form, e.g. clusterrolebinding/foo. */
  const slashed = verb !== "exec" && rawResource?.includes("/");
  const resource = slashed ? rawResource!.split("/")[0] : rawResource;
  const name = slashed ? rawResource!.split("/").slice(1).join("/") : rawName;

  const rbacOutput = resource ? kubectlRbac(verb, resource, name, flags) : null;
  if (rbacOutput !== null) return rbacOutput;

  const isPod = ["pod", "pods", "po"].includes(resource ?? "");
  const isNode = ["node", "nodes", "no"].includes(resource ?? "");
  const isNamespace = ["namespace", "namespaces", "ns"].includes(
    resource ?? "",
  );
  const isRuntimeClass = [
    "runtimeclass",
    "runtimeclasses",
    "rc",
  ].includes(resource ?? "");

  if (verb === "exec") {
    return kubectlExec(resource, tail.join(" "), flags);
  }

  if (verb === "get" && isPod) {
    if (flags.yaml) return getPodYaml(name, flags);
    return getPods(flags);
  }

  if (verb === "get" && isNode) return getNodes(flags);
  if (verb === "get" && isNamespace) return getNamespaces(name, flags);
  if (verb === "describe" && isNamespace) return describeNamespace(name);

  const isClusterPolicy = ["clusterpolicy", "clusterpolicies", "cpol"].includes(resource ?? "");
  const isDeployment = ["deployment", "deployments", "deploy"].includes(resource ?? "");
  const isEvent = ["event", "events", "ev"].includes(resource ?? "");

  if (verb === "get" && isClusterPolicy) return getClusterPolicies(name, flags);
  if (verb === "describe" && isClusterPolicy) return describeClusterPolicy(name);
  if (verb === "get" && isDeployment) return getDeployments(name, flags);
  if (verb === "describe" && isDeployment) return describeDeployment(name, flags);
  if (verb === "get" && isEvent) return getEvents(flags);

  const isNetworkPolicy = ["networkpolicy", "networkpolicies", "netpol"].includes(resource ?? "");
  if (verb === "get" && isNetworkPolicy) return getNetworkPolicies(name, flags);
  if (verb === "describe" && isNetworkPolicy) {
    const scoped = inScope(networkPolicies, flags);
    const visible = name ? scoped.filter((policy) => policy.name === name) : scoped;
    if (name && visible.length === 0) return notFound("networkpolicies.networking.k8s.io", name);
    if (visible.length === 0) return noneFound(flags, true);
    return visible.map(describeNetworkPolicy).join("\n\n\n");
  }
  if (verb === "get" && isRuntimeClass) return getRuntimeClass();

  if (verb === "delete" && isPod) return deletePod(name, flags);

  if (verb === "describe" && isPod) return describePod(name, flags);
  if (verb === "describe" && isNode) return describeNode(name ?? NODE.name);

  return [`error: unknown command "${raw}"`, "", kubectlUsage()].join("\n");
}

/* -------------------------------------------------------------------------- */
/* protect                                                                    */
/* -------------------------------------------------------------------------- */

function protectUsage(): string {
  return [
    "usage: protect <command> [subcommand] [options]",
    "",
    "  protect zone list [--selector status.state=<state>]",
    "  protect zone list <name> --output json-pretty",
    "  protect zone launch --name <name> [--wait]",
    "  protect zone logs <name> [--follow]",
    "  protect image list [--output table]",
    "  protect image list-kernel-variants",
    "  protect image remove <digest>",
    "  protect image pull <reference>",
    "  protect workload list [--selector status.state=running]",
    "  protect workload launch --zone <zone> --name <name> <image>",
    "  protect workload exec <name> <command>",
    "  protect host status",
  ].join("\n");
}

function zoneList(input: string, name: string | undefined): string {
  state.zonesListed = true;

  const selector = /--selector\s+status\.state=(\w+)/.exec(input);
  const wantsJson = input.includes("json");

  let visible = zones;

  if (name && !name.startsWith("-")) {
    const zone = findZone(name);

    if (!zone) {
      return `error: zone "${name}" not found`;
    }

    visible = [zone];
  }

  if (selector) {
    visible = visible.filter((zone) => zone.state === selector[1]);
  }

  if (visible.length === 0) {
    return "No zones matched the selector.";
  }

  if (wantsJson) {
    return JSON.stringify(
      {
        zones: visible.map((zone) => ({
          name: zone.name,
          id: zone.id,
          state: zone.state,
          kernel: zone.kernel,
          resources: { cpus: zone.cpus, memory: zone.memory },
          workload: zone.pod,
        })),
      },
      null,
      2,
    );
  }

  return [
    table(
      ["NAME", "ID", "STATE", "CPUS", "MEMORY"],
      visible.map((zone) => [
        zone.name,
        zone.id,
        zone.state,
        String(zone.cpus),
        zone.memory,
      ]),
    ),
    "",
    `${visible.length} zone${visible.length === 1 ? "" : "s"} listed. ` +
      `${pods.length} pods are scheduled on this node.`,
  ].join("\n");
}

function zoneLaunch(input: string): string {
  const nameMatch = /(?:^|\s)--name\s+(\S+)/.exec(input);
  const name = nameMatch?.[1];

  if (!name || name.startsWith("-")) {
    return "usage: protect zone launch --name <name> [--wait]";
  }

  if (findZone(name)) {
    return `error: zone "${name}" already exists`;
  }

  const zone: Zone = {
    name,
    id: `z-${Math.random().toString(16).slice(2, 8)}`,
    state: "ready",
    cpus: 2,
    memory: "2048MB",
    kernel: ZONE_KERNEL,
    pod: "",
  };

  zones.push(zone);

  return [
    `zone/${zone.name} created`,
    `id: ${zone.id}`,
    `state: ${zone.state}`,
    `cpus: ${zone.cpus}`,
    `memory: ${zone.memory}`,
  ].join("\n");
}

function workloadLaunch(input: string): string {
  const zoneMatch = /--zone\s+(\S+)/.exec(input);
  const nameMatch = /--name\s+(\S+)/.exec(input);
  const imageMatch = /(?:^|\s)([^\s]+)(?:\s*)$/.exec(input.trim());

  const zoneName = zoneMatch?.[1];
  const workloadName = nameMatch?.[1];
  const image = imageMatch?.[1];

  if (!zoneName || !workloadName || !image || image === workloadName) {
    return "usage: protect workload launch --zone <zone> --name <name> <image>";
  }

  if (findPod(workloadName)) {
    return `error: workload "${workloadName}" already exists`;
  }

  const zone = findZone(zoneName);

  if (!zone) {
    return `error: zone "${zoneName}" not found`;
  }

  if (zone.state !== "ready") {
    return `error: zone "${zoneName}" is not ready`;
  }

  if (zone.pod) {
    return `error: zone "${zoneName}" already has workload "${zone.pod}"`;
  }

  zone.pod = workloadName;

  const pod: Pod = {
    name: workloadName,
    namespace: "default",
    app: workloadName,
    node: NODE.name,
    status: "Running",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": zone.kernel,
      "dev.edera/initial-memory-request": "2048",
    },
    zone: zone.name,
    image,
  };

  pods.push(pod);
  virtualFiles[`/home/ivy/manifests/${pod.name}.yaml`] = manifestFor(pod);
  directories.add("/home/ivy/manifests");

  return [
    `workload/${pod.name} launched`,
    `zone: ${zone.name}`,
    `image: ${pod.image}`,
    `state: ${pod.status.toLowerCase()}`,
  ].join("\n");
}

function zoneLogs(name: string | undefined, follow: boolean): string {
  if (!name) {
    return "error: zone name may not be empty";
  }

  const zone = findZone(name);

  if (!zone) {
    return `error: zone "${name}" not found`;
  }

  if (zone.state === "ready") {
    const lines = [
      `[zone ${zone.name}] booting ${zone.kernel}`,
      `[zone ${zone.name}] ${zone.cpus} vcpu, ${zone.memory}`,
      `[zone ${zone.name}] zone ready`,
    ];

    if (zone.pod) {
      const pod = findPod(zone.pod);

      if (pod) {
        lines.push(
          `[zone ${zone.name}] workload ${pod.name} running image ${pod.image}`,
        );
      }
    }

    if (
      follow &&
      zone.name === "my-zone" &&
      zone.pod === "web-server" &&
      currentStage()?.title === "Launch a zoned workload"
    ) {
      lines.push("[zone my-zone] following logs for workload web-server");
      lines.push("[zone my-zone] nginx: worker process started");
      lines.push("[zone my-zone] GET / HTTP/1.1 200");
      lines.push("");
      lines.push("FINAL FLAG");
      lines.push("----------");
      lines.push("EDERA{ZONE_WORKLOAD_LAUNCH}");
      lines.push("");
      lines.push("Submit this flag to complete the CTF:");
      lines.push("submit EDERA{ZONE_WORKLOAD_LAUNCH}");
    }

    return lines.join("\n");
  }

  return [
    `[zone ${zone.name}] requesting ${zone.memory}`,
    ...(zone.failure ?? []).map((line) =>
      line ? `[zone ${zone.name}] ${line}` : "",
    ),
    `[zone ${zone.name}] state: failed`,
  ].join("\n");
}

function imageList(input: string): string {
  if (input.includes("json")) {
    return JSON.stringify({ images }, null, 2);
  }

  return table(
    ["REFERENCE", "DIGEST", "FORMAT", "SIZE"],
    images.map((image) => [
      image.reference,
      image.digest,
      image.format,
      image.size,
    ]),
  );
}

const VULNERABLE_IMAGE_DIGEST = "sha256:a766a07ccdc7b9dae4f45d0f811a7dfbd5845fe610514b313b3aba831fc7b44b";

function vulnerableImageRemoved(): boolean {
  return !images.some((image) => image.digest === VULNERABLE_IMAGE_DIGEST);
}

/* Images backing a running zone (kernels) or workload can't be removed. */
function imageInUse(image: CachedImage): string | null {
  const zone = zones.find((candidate) => candidate.kernel === image.reference);
  if (zone) return `zone ${zone.name}`;
  const pod = pods.find((candidate) => candidate.image === image.reference && candidate.zone);
  if (pod) return `workload ${pod.name}`;
  return null;
}

function imageRemove(digest: string | undefined): string {
  if (!digest) return "error: missing image digest\n\nusage: protect image remove <digest>";

  const image = images.find((candidate) => candidate.digest === digest);
  if (!image) {
    const byReference = images.find((candidate) => candidate.reference === digest);
    return byReference
      ? `error: image not found: ${digest}\nImages are removed by digest. Run 'protect image list' to find it.`
      : `error: image not found: ${digest}`;
  }

  const usedBy = imageInUse(image);
  if (usedBy) return `error: image ${image.digest} is in use by ${usedBy}`;

  images.splice(images.indexOf(image), 1);
  const output = [`removed image ${image.digest} (${image.reference})`];

  if (image.digest === VULNERABLE_IMAGE_DIGEST && currentStage()?.flag === K07_FLAG) {
    output.push("", captureCurrentStage());
  }

  return output.join("\n");
}

function imagePull(reference: string | undefined, input: string): string {
  if (!reference) return "error: missing image reference\n\nusage: protect image pull <reference>";

  const existing = images.find((image) => image.reference === reference);
  if (existing && !input.includes("--overwrite-cache")) {
    return `image ${reference} is already cached (${existing.digest})`;
  }

  /* Deterministic fake digest so repeated pulls are stable. */
  let hash = 0x811c9dc5;
  for (const char of reference) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  const digest = `sha256:${Array.from({ length: 8 }, (_, index) =>
    ((hash ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0).toString(16).padStart(8, "0"),
  ).join("")}`;

  if (existing) images.splice(images.indexOf(existing), 1);
  images.push({ reference, digest, format: "squashfs", size: "64.0MB" });
  return [`pulled ${reference}`, `digest: ${digest}`].join("\n");
}

function listKernelVariants(): string {
  return [
    table(
      ["VARIANT", "IMAGE", "NOTES"],
      kernelVariants.map((variant) => [
        variant.name,
        variant.image,
        variant.notes,
      ]),
    ),
    "",
    "Request a variant with the dev.edera/kernel-variant pod annotation.",
  ].join("\n");
}

function workloadList(input: string): string {
  const selector = /--selector\s+status\.state=(\w+)/.exec(input);
  const requestedState = selector?.[1];

  const running = zones
    .filter((zone) => zone.state === "ready")
    .map((zone) => {
      const pod = findPod(zone.pod);

      return [zone.pod, zone.name, "running", pod?.image ?? "unknown"];
    });

  const visible = requestedState
    ? running.filter((row) => row[2] === requestedState)
    : running;

  if (visible.length === 0) {
    return "No workloads matched the selector.";
  }

  return [
    table(["NAME", "ZONE", "STATE", "IMAGE"], visible),
    "",
    "Workloads are only visible here when they run inside a zone.",
  ].join("\n");
}

function workloadExec(name: string | undefined, rest: string): string {
  if (!name) {
    return "error: workload name may not be empty";
  }

  const pod = findPod(name);

  if (!pod) {
    return `error: workload "${name}" not found`;
  }

  if (!pod.zone) {
    return [
      `error: workload "${name}" is not managed by the Edera daemon`,
      "",
      "It has no zone, so there is nothing for protect to exec into.",
      "Use kubectl exec for containers on the default runtime.",
    ].join("\n");
  }

  const zone = findZone(pod.zone);

  if (zone?.state !== "ready") {
    return `error: zone "${pod.zone}" is not ready`;
  }

  const wantsKernel = /proc\/version|uname/.test(rest);

  if (!wantsKernel) {
    return [
      `[${pod.name}] command executed in ${zone.name}`,
      "",
      "Try reading /proc/version to see which kernel this workload booted.",
    ].join("\n");
  }

  const version = zone.kernel.split(":")[1] ?? "6.15";

  return [
    `Linux version ${version}-edera-zone (zone@${zone.name})`,
    "",
    `This workload booted its own kernel from ${zone.kernel}.`,
    `The node itself is running ${NODE.kernelVersion}.`,
  ].join("\n");
}

function hostStatus(): string {
  return [
    "daemon:    running",
    `node:      ${NODE.name}`,
    `kernel:    ${NODE.kernelVersion}`,
    `zones:     ${zones.filter((zone) => zone.state === "ready").length} ready, ${
      zones.filter((zone) => zone.state === "failed").length
    } failed`,
    `workloads: ${pods.length} pods scheduled`,
  ].join("\n");
}

function protectCli(input: string): string {
  const args = input.split(/\s+/).slice(1);
  const [command, subcommand, name] = args;

  if (!command) {
    return protectUsage();
  }

  if (command === "zone") {
    if (subcommand === "list") return zoneList(input, name);
    if (subcommand === "launch") return zoneLaunch(input);
    if (subcommand === "logs") {
      return zoneLogs(name, input.includes("--follow"));
    }
  }

  if (command === "image") {
    if (subcommand === "list") return imageList(input);
    if (subcommand === "remove") return imageRemove(name);
    if (subcommand === "pull") {
      return imagePull(args.slice(2).find((arg) => !arg.startsWith("-")), input);
    }
    if (subcommand === "list-kernel-variants") {
      return listKernelVariants();
    }
  }

  if (command === "workload") {
    if (subcommand === "list") return workloadList(input);
    if (subcommand === "launch") return workloadLaunch(input);
    if (subcommand === "exec") return workloadExec(name, input);
  }

  if (command === "host" && subcommand === "status") return hostStatus();

  return [`error: unknown command "${input}"`, "", protectUsage()].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                 */
/* -------------------------------------------------------------------------- */

function submit(value: string): string {
  const stage = currentStage();

  if (!stage) {
    return [
      "CTF COMPLETE",
      "-----------",
      "All ten OWASP-aligned flags captured and submitted.",
      "",
      "Your reward is waiting for you:",
      "https://edera.dev/stories/ocap-bounded-authority",
    ].join("\n");
  }

  const answer = value.trim().toLowerCase().replace(/^["']|["']$/g, "");

  if (!answer) {
    return "usage: submit <value>";
  }

  const matched = stage.answers.some(
    (candidate) => candidate.toLowerCase() === answer,
  );

  if (!matched && stage.nudges?.[answer]) {
    return stage.nudges[answer];
  }

  /*
   * K04 is about making the policy admit the workload, so naming the label
   * is not enough: the Pod must actually have been admitted.
   */
  if (matched && stage.flag === K07_FLAG && !vulnerableImageRemoved()) {
    return "Not yet. That image is still in the cache. Remove it with protect image remove.";
  }

  if (matched && stage.flag === K04_FLAG && !paymentsPod()) {
    return [
      "Not yet. payments-worker in customer-e is still 0/1.",
      "Knowing the label isn't enough: apply it to the namespace with kubectl label.",
    ].join("\n");
  }

  if (!matched) {
    /* A correct answer for a stage already passed is a useful nudge. */
    const earlier = stages
      .slice(0, state.stage)
      .some((past) =>
        past.answers.some(
          (candidate) => candidate.toLowerCase() === answer,
        ),
      );

    if (earlier) {
      return [
        "Already captured.",
        "",
        `Current objective: ${stage.objective}`,
      ].join("\n");
    }

    return [
      "Rejected.",
      "",
      `Objective ${String(state.stage + 1).padStart(2, "0")}: ${stage.objective}`,
      ...stage.brief.map((line) => `  ${line}`),
    ].join("\n");
  }

  return captureCurrentStage();
}

/* Records the current stage's flag and returns the capture message. */
function captureCurrentStage(): string {
  const stage = currentStage()!;
  state.captured.push(stage.flag);
  state.stage++;

  const next = currentStage();

  /* K04 is captured by labelling; if that already happened, say so. */
  const k04Ready =
    next?.flag === K04_FLAG && isOnboarded(BLOCKED_NAMESPACE) && Boolean(paymentsPod());
  const k07Ready = next?.flag === K07_FLAG && vulnerableImageRemoved();

  return [
    "FLAG CAPTURED",
    "-------------",
    stage.flag,
    "",
    ...stage.reward,
    "",
    next
      ? `Objective ${String(state.stage + 1).padStart(2, "0")}: ${next.objective}${
          k04Ready
            ? "\n  You've already admitted that workload. Submit the label you applied to capture this flag."
            : k07Ready
              ? "\n  You've already removed that image. Submit its digest to capture this flag."
              : ""
        }`
      : [
          "CTF COMPLETE",
          "-----------",
          "All ten OWASP-aligned flags captured and submitted.",
          "",
          "Every workload in this lab ran in its own Edera zone.",
          "Misconfigurations still happened, but each one stayed inside its zone.",
          "",
          "Your reward is waiting for you:",
          "https://edera.dev/stories/ocap-bounded-authority",
        ].join("\n"),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Command dispatch                                                           */
/* -------------------------------------------------------------------------- */

async function runCommand(command: string): Promise<string> {
  state.commandCount++;

  await sleep(180);

  const raw = command.trim();
  const normalized = raw.toLowerCase();

  if (!raw) {
    state.commandCount--;
    return "";
  }

  if (normalized === "help") {
    return renderCliHelp();
  }

  if (normalized === "objective" || normalized === "status") {
    const stage = currentStage();

    if (!stage) {
      return "All ten OWASP flags captured. The investigation is complete.";
    }

    return [
      `Objective ${String(state.stage + 1).padStart(2, "0")} of ${stages.length}: ${stage.title}`,
      "",
      stage.objective,
      ...stage.brief.map((line) => `  ${line}`),
    ].join("\n");
  }

  if (normalized === "flags") {
    if (state.captured.length === 0) {
      return "No flags captured yet. Run 'objective' to see what to look for.";
    }

    return ["CAPTURED FLAGS", "--------------", ...state.captured].join("\n");
  }

  if (normalized === "clear") {
    terminalHistory.length = 0;
    return "";
  }

  if (normalized.startsWith("submit")) {
    return submit(raw.slice(6));
  }

  if (normalized === "history") {
    if (commandHistory.length === 0) return "No commands in history yet.";

    return commandHistory
      .map((entry, index) => `${String(index + 1).padStart(4)}  ${entry}`)
      .join("\n");
  }

  /* kubectl keeps original case: namespaces and pod names are case sensitive. */
  if (
    normalized === "kubectl" ||
    normalized.startsWith("kubectl ")
  ) {
    return kubectl(raw);
  }

  if (
    normalized === "protect" ||
    normalized.startsWith("protect ")
  ) {
    return protectCli(normalized);
  }

  /* ---------------------------------------------------------------------- */
  /* Node shell                                                             */
  /* ---------------------------------------------------------------------- */

  const base64Output = base64Command(raw);
  if (base64Output !== null) return base64Output;

  const [binary, ...args] = raw.split(/\s+/);

  if (binary === "pwd") return state.cwd;
  if (binary === "whoami") return "ivy";
  if (binary === "hostname") return NODE.name;

  if (binary === "uname") {
    return args.includes("-a") || args.includes("-r")
      ? `Linux ${NODE.name} ${NODE.kernelVersion} x86_64 GNU/Linux`
      : "Linux";
  }

  if (binary === "cd") return changeDirectory(args[0]);

  if (binary === "ls") {
    const long = args.some((arg) => /^-\w*l/.test(arg));
    const hidden = args.some((arg) => /^-\w*a/.test(arg));
    const target = args.find((arg) => !arg.startsWith("-")) ?? "";

    return listDirectory(target, long, hidden);
  }

  if (binary === "cat") return readFile(args[0]);
  if (binary === "curl") return curlCommand(args, false);

  if (binary === "tree") {
    const path = resolvePath(args[0] ?? state.cwd);

    if (!directories.has(path)) {
      return `tree: ${args[0] ?? path}: not a directory`;
    }

    return [path, ...treeFrom(path)].join("\n");
  }

  if (binary === "env") {
    return [
      "USER=ivy",
      `HOSTNAME=${NODE.name}`,
      "KUBECONFIG=/home/ivy/.kube/config",
      "EDERA_SOCKET=/var/lib/edera/protect/daemon.socket",
      `PWD=${state.cwd}`,
    ].join("\n");
  }

  if (binary === "ps") {
    return table(
      ["PID", "USER", "COMMAND"],
      [
        ["1", "root", "/sbin/init"],
        ["612", "root", "/usr/sbin/protect-daemon"],
        ["988", "root", "containerd"],
        ["1204", "root", "kubelet"],
        ["2871", "ivy", "-bash"],
      ],
    );
  }

  return [
    `command not found: ${raw}`,
    "",
    "Type 'help' to see available commands.",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* UI                                                                         */
/* -------------------------------------------------------------------------- */

/*
 * Reading a pod resolves it outright. Listing zones only resolves the pods
 * that HAVE a zone — a pod missing from that list stays unknown, because its
 * absence is the clue the player is supposed to spot for themselves.
 */
function podLayer(pod: Pod): "zone" | "host" | "unknown" {
  // All initial workloads are zone-backed. Inspection reveals the security
  // finding; it does not imply that the workload is running on the host.
  if (pod.runtimeClass && pod.zone) return "zone";
  if (state.inspected.has(pod.name)) return "host";
  return "unknown";
}

function renderArchitecture(): string {
  const exposed = pods.filter(
    (pod) => state.escalationDescribed.has(pod.name) && securityProfileFor(pod).allowPrivilegeEscalation,
  );
  const found = exposed.length > 0;

  /*
   * K02: once the cluster-admin binding has been captured, every Secret is
   * shown as reachable, because that token can read them all through the
   * API regardless of which zone a workload runs in. Before that, only the
   * Secrets the player has listed appear, as neutral chips.
   */
  const adminBinding = clusterRoleBindings.find((binding) => binding.name === "report-bot-admin");
  const adminSubject = adminBinding?.subjects.find((subject) => subject.kind === "ServiceAccount");
  const rbacFound = state.captured.includes("EDERA{K02_EXCESSIVE_PERMISSIONS}") && Boolean(adminSubject);
  const adminToken = secrets.find(
    (secret) => secret.annotations?.["kubernetes.io/service-account.name"] === adminSubject?.name &&
      secret.namespace === adminSubject?.namespace,
  );
  const shownSecrets = secrets.filter(
    (secret) => rbacFound || state.secretsSeen.has(`${secret.namespace}/${secret.name}`),
  );
  const secretNamespaces = new Set(shownSecrets.map((secret) => secret.namespace));

  const secretChips = (namespace: string): string => {
    const chips = shownSecrets
      .filter((secret) => secret.namespace === namespace)
      .map((secret) => {
        const isAdminToken = rbacFound && secret === adminToken;
        const classes = ["secret-chip", rbacFound ? "secret-exposed" : "", isAdminToken ? "secret-admin" : ""].join(" ");
        const title = isAdminToken
          ? "cluster-admin token"
          : rbacFound
            ? `readable by ${adminSubject?.namespace}/${adminSubject?.name}`
            : secret.type;
        return `<span class="${classes}" title="${escapeHtml(title)}">${isAdminToken ? "admin token · " : ""}${escapeHtml(secret.name)}</span>`;
      })
      .join("");
    return chips ? `<div class="secret-chips">${chips}</div>` : "";
  };

  /* Secrets attach to the first card of their namespace only. */
  const namespacesWithCards = new Set<string>();
  const chipsOnce = (namespace: string): string => {
    if (namespacesWithCards.has(namespace)) return "";
    namespacesWithCards.add(namespace);
    return secretChips(namespace);
  };

  const cards = pods
    .map((pod) => {
      const layer = podLayer(pod);
      const zone = pod.zone ? findZone(pod.zone) : undefined;
      const flagged = exposed.some((candidate) => candidate.name === pod.name);
      const caption = flagged
        ? "privilege escalation enabled"
        : layer === "unknown"
          ? "runtime not yet inspected"
          : layer === "zone"
            ? `${zone?.name} · ${zone?.state}`
            : "no zone · host kernel";

      return `<div class="tenant-card layer-${layer} ${flagged ? "tenant-escalation" : ""}"><span class="tenant-dot"></span><strong>${pod.namespace}/${pod.app}</strong><span class="tenant-caption">${caption}</span>${chipsOnce(pod.namespace)}</div>`;
    })
    .join("");

  /* Namespaces holding Secrets but no running pods still get a card. */
  const orphanCards = [...secretNamespaces]
    .filter((namespace) => !pods.some((pod) => pod.namespace === namespace))
    .map((namespace) => `<div class="tenant-card layer-unknown"><span class="tenant-dot"></span><strong>${namespace}</strong><span class="tenant-caption">no running workloads</span>${chipsOnce(namespace)}</div>`)
    .join("");

  /* K04: the blocked tenant appears once the player has come across it. */
  const blockedCard =
    state.blockedTenantSeen && !paymentsPod()
      ? `<div class="tenant-card tenant-blocked"><span class="tenant-dot"></span><strong>${BLOCKED_NAMESPACE}/${PAYMENTS.deployment}</strong><span class="tenant-caption">0/1 · denied by ${ONBOARDING_POLICY}</span></div>`
      : "";

  const exposedNamespaces = new Set(secrets.map((secret) => secret.namespace)).size;

  const apiBox = rbacFound && adminBinding && adminSubject
    ? `
      <div class="api-box">
        <strong>KUBERNETES API · RBAC</strong>
        <span><code>${adminSubject.namespace}/${adminSubject.name}</code> → <code>${adminBinding.roleRef.kind}/${adminBinding.roleRef.name}</code> · reads every Secret in every namespace</span>
      </div>
      <div class="kernel-connector api-connector"></div>`
    : "";

  return `
    <section class="architecture ${found || rbacFound ? "architecture-compromised" : ""}">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CURRENT ARCHITECTURE</span>
          <h2>Edera-isolated workloads</h2>
        </div>
        <span class="status-pill ${found || rbacFound ? "status-danger" : "status-unknown"}">
          ${rbacFound ? "CLUSTER-ADMIN TOKEN EXPOSED" : found ? "PRIVILEGE ESCALATION ENABLED" : `${pods.length} RUNNING WORKLOAD${pods.length === 1 ? "" : "S"}`}
        </span>
      </div>

      ${apiBox}

      ${pods.length > 0 || orphanCards || blockedCard
        ? `<div class="tenant-grid">${cards}${orphanCards}${blockedCard}</div>`
        : `<div class="architecture-empty"><strong>NO WORKLOADS SCHEDULED</strong><span>Apply a manifest from <code>~/manifests</code> to restore a workload.</span></div>`}

      <div class="kernel-connector"></div>
      <div class="kernel-box ${found ? "kernel-compromised" : ""}">
        <strong>HOST KERNEL</strong>
        <span>${NODE.kernelVersion} · ${NODE.name}</span>
      </div>

      ${rbacFound && adminSubject ? `
        <div class="blast-radius">
          <span class="blast-icon">!</span>
          <div>
            <strong>${adminSubject.namespace}/${adminSubject.name} is bound to cluster-admin</strong>
            <span>Its long-lived token can read all ${secrets.length} Secrets in ${exposedNamespaces} namespaces. Zones isolate kernels, not API access, so scope service accounts to the namespaces and verbs they need.</span>
          </div>
        </div>` : ""}

      ${found ? `
        <div class="blast-radius">
          <span class="blast-icon">!</span>
          <div>
            <strong>${exposed.map((pod) => `${pod.namespace}/${pod.name}`).join(", ")} permits privilege escalation</strong>
            <span>The <code>allowPrivilegeEscalation: false</code> setting enforces the <code>no_new_privs</code> kernel flag, which prevents a process from gaining more privileges than its parent.</span>
          </div>
        </div>` : ""}
    </section>
  `;
}

function renderObjectives(): string {
  return `
    <section class="card objectives-card">
      <div class="card-heading">
        <span class="eyebrow">OBJECTIVES</span>
      </div>

      <div class="objectives">
        ${stages
          .map((stage, index) => {
            const status =
              index < state.stage
                ? "complete"
                : index === state.stage
                  ? "current"
                  : "pending";

            return `
              <div class="objective ${status}">
                <span class="objective-marker">
                  ${status === "complete" ? "✓" : status === "current" ? "→" : "·"}
                </span>

                <span>${stage.title}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderFlags(): string {
  return `
    <section class="card boundary-card">
      <div class="card-heading">
        <span class="eyebrow">CAPTURED FLAGS</span>
      </div>

      <div class="flag-list">
        ${
          state.captured.length === 0
            ? `
            <div class="flag-empty">
              <div>Run <code>objective</code> in the terminal to start.</div>
              <div>Submit your answer with <code>submit &lt;flag&gt;</code>.</div>
            </div>`
            : state.captured
                .map(
                  (flag, index) => `
                    <div class="flag-row flag-row-captured">
                      <span class="step-number">${String(index + 1).padStart(2, "0")}</span>
                      <code>${escapeHtml(flag)}</code>
                      <span class="flag-celebration" aria-hidden="true">🎉</span>
                    </div>
                  `,
                )
                .join("")
        }
      </div>
    </section>
  `;
}

function renderTerminalOutput(value: string): string {
  const allLines = value.split("\n");
  const start = allLines.indexOf("FLAG CAPTURED");

  if (start === -1 || allLines.length - start < 3) {
    return `<pre class="terminal-output-block">${terminalKubectlText(value)}</pre>`;
  }

  /* Output that led to the capture (e.g. kubectl label) is shown first. */
  const before = allLines.slice(0, start).join("\n").trim();
  const lines = allLines.slice(start);
  const flag = lines[2].trim();
  const rest = lines.slice(3).join("\n").trim();

  return `
    ${before ? `<pre class="terminal-output-block">${terminalKubectlText(before)}</pre>` : ""}
    <div class="terminal-flag-capture" role="status" aria-live="polite">
      <div class="terminal-flag-banner">
        <span>FLAG CAPTURED</span>
        <span class="terminal-flag-party" aria-hidden="true">🎉</span>
      </div>
      <div class="terminal-flag-value">${escapeHtml(flag)}</div>
      ${
        rest
          ? `<pre class="terminal-output-block terminal-flag-followup">${terminalKubectlText(rest)}</pre>`
          : ""
      }
    </div>
  `;
}

function renderTerminal(): string {
  return `
    <section class="terminal-panel">
      <div class="terminal-titlebar">
        <div class="window-controls">
          <span></span>
          <span></span>
          <span></span>
        </div>

        <div class="terminal-session">
          <span class="terminal-status-dot"></span>
          <span>shell</span>
          <span class="terminal-separator">/</span>
          <span>worker-02</span>
        </div>

        <div class="terminal-live">
          <span></span>
          LIVE
        </div>
      </div>

      <div class="terminal-output" id="terminal-output">
        ${
          terminalHistory.length === 0
            ? `
              <div class="terminal-welcome">
                <div class="terminal-brand">EDERA</div>
                <div class="terminal-lab">ISOLATION RESEARCH LAB</div>
                <div class="terminal-challenge">
                  SECURITY CHALLENGE 02
                </div>

                <div class="terminal-rule"></div>

                <div class="terminal-welcome-copy">
                  You are auditing a node that runs a mix of zone-backed
                  and default-runtime workloads.
                  <br />
                  Ten flags mapped to the OWASP Kubernetes Top 10. Each one is a value you read out of a real
                  command. Capture them in order.
                </div>

                <div class="terminal-rule"></div>

                <div class="terminal-hint">
                  Type <span>help</span> for commands, or
                  <span>objective</span> to begin.
                </div>
              </div>
            `
            : terminalHistory
                .map((entry) =>
                  entry.type === "command"
                    ? `
                      <div class="terminal-command-line">
                        <span class="terminal-prompt">${escapeHtml(entry.prompt ?? prompt())}</span>
                        <span class="terminal-command-text">${escapeHtml(entry.text)}</span>
                      </div>
                    `
                    : entry.type === "html"
                      ? entry.text
                      : renderTerminalOutput(entry.text),
                )
                .join("")
        }
      </div>

      <form class="terminal-input-row" id="terminal-form">
        <span class="terminal-prompt">${escapeHtml(prompt())}</span>
        <input
          id="terminal-input"
          class="terminal-input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="Terminal command"
          autofocus
        />
      </form>
    </section>
  `;
}

function render(): void {
  const stage = currentStage();

  app.innerHTML = `
    <div class="game">
      <header class="top-header">
        <a href="https://edera.dev" class="logo-link">EDERA</a>
        <a href="https://on.edera.dev" target="_blank" class="edera-free-cta">Try Edera for free →</a>
      </header>

      <main class="main">
        <section class="mission">
          <div class="mission-copy">
            <span class="eyebrow">MISSION BRIEF</span>
            <h1>
              CTF Challenge
              <em>#2</em>
            </h1>

  <div className="mission-description">
  <p>
    <strong>Kubernetes</strong> is deliberately misconfigured here.<br> 
    Use the <i><a href="https://kubernetes-top10.owasp.org/">OWASP Top 10 for Kubernetes</a></i> as your guide.
  </p>

  <p>
    Find <strong>all flaws</strong>
    before production is compromised.<br> 
    Capture all <b>10 flags</b> to complete the exercise.
  </p>
</div>
          </div>

          <div class="mission-meta">
            <div>
              <span>ENVIRONMENT</span>
              <strong>KUBERNETES</strong>
            </div>

            <div>
              <span>NODE</span>
              <strong>WORKER-02</strong>
            </div>

            <div>
              <span>FLAGS</span>
              <strong>${state.captured.length} / ${stages.length}</strong>
            </div>
          </div>
        </section>

        <section class="objective-strip">
          <div>
            <span>CURRENT OBJECTIVE</span>
            <strong>
              ${stage ? stage.objective : "Investigation complete. Collect your reward."}
            </strong>
          </div>

          <div class="objective-progress">
            ${stages
              .map((_, index) => {
                const status =
                  index < state.stage
                    ? "complete"
                    : index === state.stage
                      ? "current"
                      : "pending";

                return `
                  <span class="progress-dot ${status}">
                    ${String(index + 1).padStart(2, "0")}
                  </span>
                `;
              })
              .join("")}
          </div>
        </section>

        <section class="workspace">
          ${renderTerminal()}

          <aside class="sidebar">
            <section class="card status-card">
              <div class="card-heading">
                <span class="eyebrow">LAB STATUS</span>
                <span class="status-light"></span>
              </div>

              <div class="status-stat">
                <span>COMMANDS</span>
                <strong>${state.commandCount}</strong>
              </div>

              <div class="status-stat">
                <span>FLAGS</span>
                <strong>${state.captured.length} / ${stages.length}</strong>
              </div>
            </section>

            ${renderObjectives()}
            ${/* Temporarily disabled: the Captured Flags panel adds no useful gameplay value yet. */ ""}
          </aside>
        </section>

        ${renderArchitecture()}

        ${
          complete()
            ? `
              <section class="completion-card">
                <span class="eyebrow">INVESTIGATION COMPLETE</span>
                <h2>Ten findings. One hardened cluster.</h2>
                <p>
                  customer-c/recommendation allowed privilege escalation because
                  its container security context was misconfigured. Your reward is
                  waiting at
                  <a
                    href="https://edera.dev/stories/ocap-bounded-authority"
                    target="_blank"
                    rel="noopener"
                    referrerpolicy="origin"
                  >edera.dev/love</a>.
                </p>
              </section>
            `
            : ""
        }

        <div class="edera-free-bottom">
          <a href="https://edera-dev.github.io/agent-demo/" target="_blank">Try our Webernetes Demo →</a>
        </div>

        <footer class="edera-footer">
          <img src="https://docs.edera.dev/Ivy%20Headphones.png" alt="Ivy from Edera" loading="lazy" />
          <span>Made with love by the team at <a href="https://edera.dev/love" target="_blank">Edera</a></span>
        </footer>
      </main>
    </div>
  `;

  attachTerminalHandlers();
}

/*
 * Index into commandHistory while the player is arrowing through it.
 * -1 means "not browsing", i.e. sitting on a fresh line.
 */
let historyCursor = -1;
let draft = "";

function attachTerminalHandlers(): void {
  const form = document.querySelector<HTMLFormElement>("#terminal-form");
  const input = document.querySelector<HTMLInputElement>("#terminal-input");
  const output = document.querySelector<HTMLDivElement>("#terminal-output");

  if (!form || !input || !output) return;

  requestAnimationFrame(() => {
    output.scrollTop = output.scrollHeight;
    input.focus();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (commandHistory.length === 0) return;

    /* Stop the caret jumping to the start or end of the line. */
    event.preventDefault();

    if (event.key === "ArrowUp") {
      if (historyCursor === -1) {
        draft = input.value;
        historyCursor = commandHistory.length - 1;
      } else if (historyCursor > 0) {
        historyCursor--;
      }

      input.value = commandHistory[historyCursor];
    } else {
      if (historyCursor === -1) return;

      if (historyCursor < commandHistory.length - 1) {
        historyCursor++;
        input.value = commandHistory[historyCursor];
      } else {
        historyCursor = -1;
        input.value = draft;
      }
    }

    /* Put the caret at the end of the recalled command. */
    requestAnimationFrame(() => {
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const command = input.value.trim();

    if (!command) {
      input.focus();
      return;
    }

    /* Consecutive duplicates are noise in the recall list. */
    if (commandHistory[commandHistory.length - 1] !== command) {
      commandHistory.push(command);
    }

    historyCursor = -1;
    draft = "";

    input.disabled = true;

    terminalHistory.push({
      type: "command",
      text: command,
      prompt: prompt(),
    });
    render();

    const result = await runCommand(command);

    if (result) {
      terminalHistory.push({
        type:
          command.trim().toLowerCase() === "help"
            ? "html"
            : "output",
        text: result,
      });
    }

    render();

    document.querySelector<HTMLInputElement>("#terminal-input")?.focus();
  });
}

render();
