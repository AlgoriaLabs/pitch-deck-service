terraform {
  required_version = ">= 1.6"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
  }
}

# Auth comes from ~/.oci/config (created by `oci setup config`). Pick the profile with var.oci_profile.
provider "oci" {
  config_file_profile = var.oci_profile
  region              = var.region
}
