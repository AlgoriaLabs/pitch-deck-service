# One private Object Storage bucket for Terraform state, so your laptop and GitHub Actions deploy from the same
# state (and lock it, so they never deploy at once). Created once by `npm run deploy`, which then writes
# deploy/terraform/state.hcl. Its own state is tiny and stays local: losing it loses nothing but this record.
# Always Free: Object Storage includes 20 GB; a state file is a few KB.

terraform {
  required_version = ">= 1.12"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0"
    }
  }
}

provider "oci" {
  config_file_profile = var.oci_profile
  region              = var.region
}

variable "oci_profile" {
  type    = string
  default = "DEFAULT"
}

variable "region" {
  type = string
}

variable "compartment_ocid" {
  type = string
}

variable "bucket_name" {
  type    = string
  default = "pitch-deck-agent-tfstate"
}

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.compartment_ocid
}

resource "oci_objectstorage_bucket" "state" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = var.bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  # Every apply keeps the previous state as a version: a bad apply can be rolled back.
  versioning = "Enabled"
}

output "bucket" {
  value = oci_objectstorage_bucket.state.name
}

output "namespace" {
  value = data.oci_objectstorage_namespace.this.namespace
}
