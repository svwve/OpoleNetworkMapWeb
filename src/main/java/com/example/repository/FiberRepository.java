package com.example.repository;

import com.example.model.Fiber;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FiberRepository extends JpaRepository<Fiber, Long> {
    List<Fiber> findByProjectId(Long projectId);
}
