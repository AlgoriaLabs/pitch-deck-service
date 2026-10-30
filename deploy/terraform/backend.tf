# State lives in an OCI Object Storage bucket, shared by your laptop and GitHub Actions, with locking.
# The bucket, namespace and region come from state.hcl, which `npm run deploy` writes the first time:
#   terraform init -backend-config=state.hcl
# Run Terraform through `npm run deploy` and this is handled for you.
terraform {
  backend "oci" {}
}
