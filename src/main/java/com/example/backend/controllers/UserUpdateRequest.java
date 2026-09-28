package com.example.backend.controllers;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UserUpdateRequest(
        @Size(min = 8, max = 72) String password,
        @Pattern(regexp = "ADMIN|OPERATOR") String role) {
}
