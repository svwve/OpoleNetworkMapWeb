package com.example.backend.controllers;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record FiberRequest(
        @NotNull @Positive Long projectId,
        @NotBlank @Size(max = 255) String name,
        @NotBlank @Size(max = 1_000_000) String pathJson,
        @NotBlank @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String color,
        @NotNull @Min(1) @Max(12) Integer thickness,
        Boolean isVisible) {
}
