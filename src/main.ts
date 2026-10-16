import "./style.css";
import "./edera-chrome.css";

interface Pod {
  name: string;
  namespace: string;
  app: string;
  node: string;
  status: string;
  privileged: boolean;
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
    status: "ContainerCreating",
    privileged: false,
    runtimeClass: "edera",
    annotations: {
      "dev.edera/kernel": ZONE_KERNEL,
      "dev.edera/initial-memory-request": "24576",
    },
    zone: "zone-analytics-d",
    image: "ghcr.io/acme/analytics-batch:0.9.0",
  },
  {
    /*
     * The finding. Privileged, and the RuntimeClass was never set, so this
     * container runs straight on the host kernel with elevated privileges.
     */
    name: "recommendation-c",
    namespace: "customer-c",
    app: "recommendation",
    node: NODE.name,
    status: "Running",
    privileged: true,
    runtimeClass: null,
    annotations: {
      "dev.edera/initial-memory-request": "2048",
    },
    zone: null,
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
    state: "failed",
    cpus: 4,
    memory: "24576MB",
    kernel: ZONE_KERNEL,
    pod: "analytics-batch-d",
    failure: [
      "zone create requested 24576MB",
      "node worker-02 allocatable memory: 14Gi",
      "insufficient memory to start zone",
      "",
      "Reduce dev.edera/initial-memory-request on the pod",
      "or schedule the workload on a larger node.",
    ],
  },
];

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
  flag: string;
  reward: string[];
}

const stages: Stage[] = [
  {
    title: "Zone kernel",
    objective: "Find the zone kernel image pinned to a customer workload.",
    brief: [
      "Every Edera-backed pod pins the kernel it boots in a",
      "metadata annotation. Read a pod and submit that image.",
    ],
    answers: [ZONE_KERNEL],
    flag: "EDERA{ZONE_KERNEL_6_15}",
    reward: [
      "That annotation is the pod asking for a specific kernel.",
      "Pods without it are not booting a kernel of their own.",
    ],
  },
  {
    title: "Image digest",
    objective: "Pin the zone kernel to a digest from the local cache.",
    brief: [
      "A tag can move. Find the digest the daemon actually",
      "cached for that kernel image and submit it.",
    ],
    answers: [
      images[0].digest,
      images[0].digest.replace("sha256:", ""),
      images[0].digest.slice(0, 19),
    ],
    flag: "EDERA{DIGEST_PINNED}",
    reward: [
      "The digest is what the zone really boots.",
      "Verify zone kernel images against it before you trust a tag.",
    ],
  },
  {
    title: "Kernel variant",
    objective: "Identify the kernel variant the eBPF workload requests.",
    brief: [
      "One workload needs kernel features the default variant",
      "does not ship. Name the variant it asks for.",
    ],
    answers: ["ebpf", "dev.edera/kernel-variant=ebpf"],
    flag: "EDERA{EBPF_VARIANT}",
    reward: [
      "Variants let a workload get BTF and BPF LSM without",
      "changing the kernel every other tenant runs.",
    ],
  },
  {
    title: "Failed zone",
    objective: "Find the zone that failed to start.",
    brief: [
      "One pod is stuck. Filter zones by state and submit the",
      "name of the zone that never came up.",
    ],
    answers: ["zone-analytics-d"],
    flag: "EDERA{ZONE_FAILED_OOM}",
    reward: [
      "A zone that cannot start is loud and visible.",
      "A workload with no zone at all is silent. Keep counting.",
    ],
  },
  {
    title: "Missing RuntimeClass",
    objective: "Find the workload running without a zone.",
    brief: [
      "Six pods are scheduled. There are five zones, and one",
      "of them failed. Name the pod that never asked for one.",
    ],
    answers: ["recommendation-c", "customer-c/recommendation-c"],
    flag: "EDERA{NO_RUNTIME_CLASS}",
    reward: [
      "It is privileged and it has no runtimeClassName.",
      "Nothing rejected it. It simply got the default runtime.",
    ],
  },
  {
    title: "Launch a zoned workload",
    objective: "Create a zone, launch nginx into it, and follow its zone logs.",
    brief: [
      "Create a zone named my-zone, launch web-server with nginx:latest",
      "into it, list the workload, then follow the zone logs and submit the final flag.",
    ],
    answers: ["EDERA{ZONE_WORKLOAD_LAUNCH}"],
    flag: "EDERA{ZONE_WORKLOAD_LAUNCH}",
    reward: [
      "The workload is running inside its own Edera zone.",
      "The final flag was emitted by the zone log stream.",
    ],
  },
];

interface GameState {
  stage: number;
  captured: string[];
  commandCount: number;
  /* Pods the player has read in detail, used to reveal the diagram. */
  inspected: Set<string>;
  zonesListed: boolean;
  cwd: string;
  namespace: string;
}

const state: GameState = {
  stage: 0,
  captured: [],
  commandCount: 0,
  inspected: new Set<string>(),
  zonesListed: false,
  cwd: "/home/ivy",
  namespace: "default",
};

/* Shell history, oldest first. Recalled with the up and down arrows. */
const commandHistory: string[] = [];

interface TerminalEntry {
  type: "command" | "output" | "html";
  text: string;
}

const terminalHistory: TerminalEntry[] = [];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Application root not found.");
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
        command: "kubectl get namespaces",
        description: "List the namespaces in the cluster.",
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
      { command: "whoami", description: "Print the current user." },
      { command: "hostname", description: "Print the node hostname." },
      { command: "uname -a", description: "Display kernel and system information." },
      { command: "env", description: "Display the simulated node environment." },
      { command: "ps", description: "List simulated running processes." },
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
  "/proc",
  "/var",
  "/var/lib",
  "/var/lib/edera",
  "/var/lib/edera/protect",
  "/var/lib/edera/protect/images",
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
    "  containers:",
    `  - name: ${pod.app}`,
    `    image: ${pod.image}`,
    "    securityContext:",
    `      privileged: ${pod.privileged}`,
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

  "/home/ivy/.profile": [
    "# ivy engineer, worker-02",
    "export KUBECONFIG=/home/ivy/.kube/config",
    "export EDERA_SOCKET=/var/lib/edera/protect/daemon.socket",
  ].join("\n"),

  "/home/ivy/README": [
    "Node audit notes",
    "----------------",
    "Manifests for everything scheduled here are in ./manifests.",
    "",
    "kubectl and protect are both on PATH. The daemon socket is",
    "readable by this account, so protect talks to it directly.",
  ].join("\n"),
};

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
    "  kubectl get nodes [-o wide] [--show-labels]",
    "  kubectl describe node worker-02",
    "  kubectl get namespaces",
    "  kubectl get runtimeclass",
    "  kubectl apply -f <file|directory>",
    "  kubectl delete pod <name> -n <namespace>",
    "  kubectl delete -f <file|directory>",
    "  kubectl exec <name> -n <namespace> -- <command>",
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
      "3h12m",
    ];

    if (flags.allNamespaces) row.unshift(pod.namespace);
    if (flags.wide) {
      row.push(`10.244.1.${21 + pods.indexOf(pod)}`, pod.node);
    }
    if (flags.showLabels) row.push(labelString(pod));

    return row;
  });

  return table(headers, rows);
}

function resolvePod(name: string, flags: KubectlFlags): Pod | undefined {
  return pods.find(
    (pod) =>
      pod.name === name &&
      (flags.allNamespaces || pod.namespace === flags.namespace),
  );
}

function describePod(name: string | undefined, flags: KubectlFlags): string {
  if (!name) return "error: resource name may not be empty";

  const pod = resolvePod(name, flags);

  if (!pod) return notFound("pods", name);

  state.inspected.add(pod.name);

  const annotationLines = Object.entries(pod.annotations).map(
    ([key, value], index) =>
      index === 0
        ? `Annotations:   ${key}: ${value}`
        : `               ${key}: ${value}`,
  );

  const labelLines = Object.entries(labelsFor(pod)).map(([key, value], index) =>
    index === 0
      ? `Labels:        ${key}=${value}`
      : `               ${key}=${value}`,
  );

  return [
    `Name:          ${pod.name}`,
    `Namespace:     ${pod.namespace}`,
    `Node:          ${pod.node}`,
    `Status:        ${pod.status}`,
    ...labelLines,
    ...annotationLines,
    `runtimeClassName:  ${pod.runtimeClass ?? "<none>"}`,
    "",
    "Containers:",
    `  ${pod.app}:`,
    `    Image:       ${pod.image}`,
    `    Privileged:  ${pod.privileged}`,
    "",
    "Events:",
    pod.status === "Running"
      ? "  Normal  Started  container started"
      : "  Warning  FailedCreatePodSandbox  zone did not become ready",
  ].join("\n");
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
    "  containers:",
    `  - name: ${pod.app}`,
    `    image: ${pod.image}`,
    "    securityContext:",
    `      privileged: ${pod.privileged}`,
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

function getNamespaces(): string {
  const names = [...new Set(["default", ...pods.map((pod) => pod.namespace)])];

  return table(
    ["NAME", "STATUS", "AGE"],
    names.map((name) => [name, "Active", "41d"]),
  );
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
      !["-n", "--namespace", "-o", "--output", "-l", "--selector"].includes(
        head[index - 1] ?? "",
      ),
  );

  const [verb, resource, name] = positional;
  const flags = parseFlags(head);

  if (!verb) return kubectlUsage();

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
  if (verb === "get" && isNamespace) return getNamespaces();
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
      "All six flags captured and submitted.",
      "",
      "Your reward is waiting for you:",
      "https://edera.dev/stories/disaggregated-kubernetes-contain-the-blast-radius",
    ].join("\n");
  }

  const answer = value.trim().toLowerCase().replace(/^["']|["']$/g, "");

  if (!answer) {
    return "usage: submit <value>";
  }

  const matched = stage.answers.some(
    (candidate) => candidate.toLowerCase() === answer,
  );

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

  state.captured.push(stage.flag);
  state.stage++;

  const next = currentStage();

  return [
    "FLAG CAPTURED",
    "-------------",
    stage.flag,
    "",
    ...stage.reward,
    "",
    next
      ? `Objective ${String(state.stage + 1).padStart(2, "0")}: ${next.objective}`
      : [
          "CTF COMPLETE",
          "-----------",
          "All six flags captured and submitted.",
          "",
          "The final flag was emitted by the zone log stream.",
          "A workload was launched into its own Edera zone.",
          "",
          "Your reward is waiting for you:",
          "https://edera.dev/stories/disaggregated-kubernetes-contain-the-blast-radius",
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
      return "All six flags captured. The investigation is complete.";
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
  if (state.inspected.has(pod.name)) {
    return pod.runtimeClass && pod.zone ? "zone" : "host";
  }

  if (state.zonesListed && pod.zone) return "zone";

  return "unknown";
}

function renderArchitecture(): string {
  const exposed = pods.filter((pod) => podLayer(pod) === "host");
  const found = exposed.length > 0;

  const cards = pods
    .map((pod) => {
      const layer = podLayer(pod);
      const zone = pod.zone ? findZone(pod.zone) : undefined;

      const caption =
        layer === "unknown"
          ? "runtime not yet inspected"
          : layer === "zone"
            ? `${zone?.name} · ${zone?.state}`
            : "no zone · host kernel";

      return `<div class="tenant-card layer-${layer}"><span class="tenant-dot"></span><strong>${pod.namespace}/${pod.app}</strong><span>${caption}</span></div>`;
    })
    .join("");

  return `
    <section class="architecture ${found ? "architecture-compromised" : ""}">
      <div class="section-heading">
        <div>
          <span class="eyebrow">CURRENT ARCHITECTURE</span>
          <h2>Mixed-runtime node</h2>
        </div>
        <span class="status-pill ${
          found ? "status-danger" : "status-unknown"
        }">
          ${
            found
              ? "UNPROTECTED WORKLOAD"
              : pods.length > 0
                ? `${pods.length} WORKLOAD${pods.length === 1 ? "" : "S"}`
                : "NO WORKLOADS"
          }
        </span>
      </div>

      ${
        pods.length > 0
          ? `<div class="tenant-grid">${cards}</div>`
          : `
            <div class="architecture-empty">
              <strong>NO WORKLOADS SCHEDULED</strong>
              <span>Apply a manifest from <code>~/manifests</code> to restore a workload.</span>
            </div>
          `
      }

      <div class="kernel-connector"></div>

      <div class="kernel-box ${found ? "kernel-compromised" : ""}">
        <strong>HOST KERNEL</strong>
        <span>${NODE.kernelVersion} · ${NODE.name}</span>
      </div>

      ${
        found
          ? `
            <div class="blast-radius">
              <span class="blast-icon">!</span>
              <div>
                <strong>${exposed
                  .map((pod) => `${pod.namespace}/${pod.app}`)
                  .join(", ")} has no zone</strong>
                <span>
                  It runs directly on the host kernel shown above, with
                  privileged access, alongside every zone-backed tenant.
                </span>
              </div>
            </div>
          `
          : ""
      }
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
  const lines = value.split("\n");

  if (lines[0] !== "FLAG CAPTURED" || lines.length < 3) {
    return `<pre class="terminal-output-block">${terminalKubectlText(value)}</pre>`;
  }

  const flag = lines[2].trim();
  const rest = lines.slice(3).join("\n").trim();

  return `
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
                  SECURITY CHALLENGE 01
                </div>

                <div class="terminal-rule"></div>

                <div class="terminal-welcome-copy">
                  You are auditing a node that runs a mix of zone-backed
                  and default-runtime workloads.
                  <br />
                  Six flags. Each one is a value you read out of a real
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
                        <span class="terminal-prompt">${escapeHtml(prompt())}</span>
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
    You have access a deliberately misconfigured <strong>Kubernetes cluster</strong>.<br> 
    Use the <br><i>OWASP Top 10 for Kubernetes</i> as your guide.
  </p>

  <p>
    Find <strong>10 misconfigurations</strong>
    that could lead to a production compromise.<br> 
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
            ${renderFlags()}
          </aside>
        </section>

        ${renderArchitecture()}

        ${
          complete()
            ? `
              <section class="completion-card">
                <span class="eyebrow">INVESTIGATION COMPLETE</span>
                <h2>A RuntimeClass nobody enforced.</h2>
                <p>
                  customer-c/recommendation ran privileged on the host kernel
                  because one field was missing from its spec. Your reward is
                  waiting at
                  <a
                    href="https://edera.dev/stories/disaggregated-kubernetes-contain-the-blast-radius"
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
          <a href="https://ndouglas-edera.github.io/my-webernetes-demo/" target="_blank">Try our Webernetes Demo →</a>
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

    terminalHistory.push({ type: "command", text: command });
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
