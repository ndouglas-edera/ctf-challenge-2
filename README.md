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
```
```
ls -la
```
```
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
This describes all pods across ```all``` namespaces
```
kubectl describe pods --all-namespaces
```
If you only want pods in the current ```default``` namespace:
```
kubectl describe pods
```
You're looking for the pod that is **privileged** and/or bypassing the Edera runtime isolation.
```
kubectl describe pod recommendation-c -n customer-c
```
The source identifies the accepted answer as ```recommendation-c```.
```
submit recommendation-c
```
<br/><br/>

### K02: Overly Permissive Authorisation Configurations
This command dumps every secret. One is a long-lived token which the Kubernetes guide flags as a risk:
```
kubectl get secrets -A -o yaml
```

You can actually decodes it to a JSON Web Token naming the account.
```
echo bGFiLW9ubHktbW9kZWwta2V5LTAwMDA= | base64 -d
```

The **binding** shows ```report-bot-admin``` granting ```cluster-admin``` to ```customer-b/report-bot```
```
kubectl get clusterrolebindings -o wide
```

The below commands should return ```*.*``` with ```[*]```
```
kubectl auth can-i --list --as=system:serviceaccount:customer-b:report-bot
```

The source identifies the accepted answer as ```customer-b/report-bot```.
```
submit customer-b/report-bot
```

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
<br/><br/>

### K03: Secrets Management Failures
- This commands shows the app dumping its environment at startup.
- Its redaction catches ```BILLING_DB_PASSWORD=********``` but misses ```BILLING_TOKEN```. Seeing one value masked and the next one not is the real-world bug, and the clue.
- The other pods also log their config, but properly redacted (```[REDACTED]```, ```***e0f1```). Players have to check logs across workloads instead of stopping at the first suspicious line.
```
kubectl logs billing-api-b -n customer-b
```
```
submit bt-lab-7f3a9c2e5d1b
```
<br/><br/>

### K04: Lack Of Cluster-Level Policy Enforcement
- The objective says a tenant workload is **BLOCKED**
- ```kubectl get deploy -A``` shows ```customer-e/payments-worker``` at ```0/1```.
- ```kubectl get events -n customer-e``` shows Kyverno denying each pod creation and names the ```edera-tenant-onboarding``` policy, but not the label.
- The player reads the rule with ```kubectl get cpol edera-tenant-onboarding -o yaml```.
- Pods are denied unless the namespace has ```edera.dev/isolation: enforced```.
- ```kubectl get ns --show-labels``` confirms ```customer-e``` is the only namespace without it.
- ```kubectl label ns customer-e edera.dev/isolation=enforced```. The ReplicaSet retry is admitted, the pod starts ```Running``` in its own Edera zone, and the flag is captured.
<br/><br/>

### K05: Missing Network Segmentation Controls
<br/><br/>

### K06: Overly-Exposed Kubernetes Components
<br/><br/>

### K07: Misconfigured And Vulnerable Cluster Components
<br/><br/>

### K08: Cluster-To-Cloud Lateral Movement
<br/><br/>


### K09: Broken Authentication Mechanisms
<br/><br/>

### K10: Inadequate Logging And Monitoring
<br/><br/>

The challenge source lists this as the final stage.
