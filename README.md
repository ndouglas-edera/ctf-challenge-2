# CTF Challenge 2
This CTF challenge was designed around the **OWASP Top 10 for Kubernetes**<br/>
https://ndouglas-edera.github.io/ctf-challenge-2/

## Challenge Layout

```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR / BRANDING                                          │
├─────────────────────────────────────────────────────────────┤
│ MISSION                                                     │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│                              │       ARCHITECTURE           │
│         TERMINAL             │                              │
│                              ├──────────────────────────────┤
│   complete the challenges    │                              │
│                              │       INVESTIGATION          │
│                              │                              │
│                              │                              │
├──────────────────────────────┴──────────────────────────────┤
│ FOOTER LINKS                                                │
└─────────────────────────────────────────────────────────────┘
```

## Approaching the lab
The source explicitly says the manifests and OWASP evidence are under 
- ```~/manifests```
- ```~/evidence```

A good way to work through this lab is to start with:
```
objective
ls -la
tree
```

### K01: Insecure Workload Configurations
The ```objective``` command tells you what the current stage wants. <br/>
The ```tree``` command is particularly useful because the virtual filesystem contains the investigation material. <br/>
For the **first** flag, inspect the Kubernetes workload configuration:
```
kubectl get pods -A
```
```
kubectl get pods -A -o wide
```
```
kubectl describe pod recommendation-c -n customer-c
```
You're looking for the pod that is **privileged** and/or bypassing the Edera runtime isolation.
```
kubectl describe pod recommendation-c -n customer-c
```
The source identifies the accepted answer as ```recommendation-c```.
```
submit recommendation-c
```

### K02: Overly Permissive Authorisation Configurations
The objective points you directly at the relevant files:
```
cat ~/manifests/rbac-audit.yaml
```
```
cat ~/evidence/rbac-review.txt
```
You'll see that ```report-bot``` is bound to ```cluster-admin```. The intended answer is therefore:
```
submit report-bot
```
The challenge source confirms both the file contents and expected answer.

### K03: Secrets Management Failures
Again, follow the objective:
```
cat ~/manifests/billing-api.yaml
```
```
cat ~/evidence/secret-review.txt
```
Look at the ```secretKeyRef```:
```
name: billing-api-token
```
So:
```
submit billing-api-token
```

### K04: Lack Of Cluster-Level Policy Enforcement

```
cat ~/manifests/policy-audit.yaml
```
```
cat ~/evidence/policy-review.txt
```
The interesting field is:
```
expected-policy: restricted-workloads
status: missing
```
Then:
```
submit restricted-workloads
```

### K05: Missing Network Segmentation Controls
```
cat ~/manifests/network-audit.yaml
```
```
cat ~/evidence/network-review.txt
```
You're looking for the namespace with no default-deny ingress:
```
submit customer-b
```
The source explicitly describes ```customer-b``` as the affected namespace.

### K06: Overly-Exposed Kubernetes Components
```
cat ~/manifests/component-exposure.yaml
```
```
cat ~/evidence/component-review.txt
```
The service is a public ```LoadBalancer``` named ```metrics-dashboard```, so:
```
submit metrics-dashboard
```

### K07: Misconfigured And Vulnerable Cluster Components
```
cat ~/manifests/vulnerable-component.yaml
```
Notice:
```
image: example.invalid/legacy-metrics:latest
```
The workload name is:
```
submit legacy-metrics
```
The challenge specifically says the objective is to find the workload using an unpinned image tag.

### K08: Cluster-To-Cloud Lateral Movement
```
cat ~/manifests/cloud-identity.yaml
```
```
cat ~/evidence/cloud-review.txt
```
The affected workload is:
```
submit invoice-exporter
```
The source also notes that the cloud endpoints in this challenge are simulated, so you aren't interacting with real cloud credentials.

### K09: Broken Authentication Mechanisms
```
cat ~/manifests/authentication-audit.yaml
```
```
cat ~/evidence/auth-review.txt
```
You'll find:
```
allowUnauthenticatedHealthAndAdmin: "true"
```
The component is:
```
submit legacy-auth-proxy
```

### K10: Inadequate Logging And Monitoring
```
cat ~/manifests/audit-policy.yaml
```
```
cat ~/evidence/audit-review.txt
```
The important bits are the omitted ```secrets``` resource and missing ```RequestResponse``` coverage. The expected answer is:
```
submit secrets-metadata-and-response
```

The challenge source lists this as the final stage.
